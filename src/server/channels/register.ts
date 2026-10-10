import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { ChannelsError } from "./summary";
import { parseChannelUrl } from "./url-parser";
import { channelPlatformSchema } from "./platform";
import type { ChannelPlatform } from "./platform";
import { diagnoseChannel } from "./diagnose";
import type { ChannelDiagnosis } from "./types";

export type RegisterChannelResult = { ok: true; channelId: string; diagnosis: ChannelDiagnosis } | { ok: false; message: string };

type TrackedChannelRow = { id: string; external_id: string; url: string; platform: string };

const TRACKED_CHANNEL_COLUMNS = "id, external_id, url, platform";

/** Postgres unique_violation — see tracked_channels' `unique (business_id, platform, external_id)` (0034). */
const UNIQUE_VIOLATION = "23505";

/**
 * "같은 business+platform+external_id면 중복 생성 안 함" (0034's unique
 * constraint) without relying on an UPDATE-capable upsert — tracked_channels
 * has no update RLS policy for the authenticated client (status/
 * next_snapshot_at are scheduler-only, see 0034's comment), so this selects
 * first and only inserts when nothing was found. If a concurrent request
 * raced this one to the insert, the unique violation is treated the same as
 * "someone else already registered it" and we just re-select.
 */
async function findOrCreateTrackedChannel(
  supabase: SupabaseClient<Database>,
  businessId: string,
  parsed: { platform: ChannelPlatform; externalId: string; normalizedUrl: string },
): Promise<TrackedChannelRow> {
  const { data: existing, error: selectError } = await supabase
    .from("tracked_channels")
    .select(TRACKED_CHANNEL_COLUMNS)
    .eq("business_id", businessId)
    .eq("platform", parsed.platform)
    .eq("external_id", parsed.externalId)
    .maybeSingle();
  if (selectError) throw new ChannelsError("DATABASE_ERROR", "등록된 채널을 확인하지 못했습니다.", { cause: selectError });
  if (existing) return existing as TrackedChannelRow;

  const { data: inserted, error: insertError } = await supabase
    .from("tracked_channels")
    .insert({ business_id: businessId, platform: parsed.platform, external_id: parsed.externalId, url: parsed.normalizedUrl })
    .select(TRACKED_CHANNEL_COLUMNS)
    .single();
  if (!insertError) return inserted as TrackedChannelRow;
  if (insertError.code !== UNIQUE_VIOLATION) throw new ChannelsError("DATABASE_ERROR", "채널을 등록하지 못했습니다.", { cause: insertError });

  const { data: afterRace, error: reselectError } = await supabase
    .from("tracked_channels")
    .select(TRACKED_CHANNEL_COLUMNS)
    .eq("business_id", businessId)
    .eq("platform", parsed.platform)
    .eq("external_id", parsed.externalId)
    .single();
  if (reselectError) throw new ChannelsError("DATABASE_ERROR", "등록된 채널을 확인하지 못했습니다.", { cause: reselectError });
  return afterRace as TrackedChannelRow;
}

/**
 * The "채널 추가" entry point (ticket 1-5): parses the URL, registers a
 * tracked_channels row if this (business, platform, external_id) isn't
 * already tracked, then diagnoses it. The first metric snapshot is saved
 * as a side effect of `diagnoseChannel` itself (ticket 1-6's "진단 시 자동
 * 저장", generalized to all three platforms in ticket 1-5's step 2) —
 * there is no separate snapshot call here.
 *
 * `platformHint` is only consulted by parseChannelUrl for a host it can't
 * classify on its own (e.g. a Tistory custom domain) — see url-parser.ts.
 */
export async function registerAndDiagnoseChannel(businessId: string, url: string, platformHint?: ChannelPlatform): Promise<RegisterChannelResult> {
  const parsed = parseChannelUrl(url, platformHint);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const supabase = await createClient();
  const channel = await findOrCreateTrackedChannel(supabase, businessId, parsed);

  const { data: business } = await supabase.from("businesses").select("name").eq("id", businessId).maybeSingle();

  const diagnosis = await diagnoseChannel(
    { id: channel.id, business_id: businessId, external_id: channel.external_id, url: channel.url, platform: channelPlatformSchema.parse(channel.platform) },
    business?.name,
  );

  return { ok: true, channelId: channel.id, diagnosis };
}
