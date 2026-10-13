import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { ChannelsError } from "./summary";
import { parseChannelUrl } from "./url-parser";
import { resolveParsedChannel } from "./preview";
import { nextDailyCollectionAt } from "./schedule";
import { channelPlatformSchema } from "./platform";
import type { ChannelPlatform } from "./platform";
import { diagnoseChannel } from "./diagnose";
import { DiagnosisRateLimitError } from "./diagnosis-rate-limit";
import type { ChannelDiagnosis } from "./types";

/** `diagnosis` is null when the channel was saved but the hourly diagnosis limit was reached: it is tracked from the next 06:00 KST anyway, and "다시 진단하기" works later. */
export type RegisterChannelResult = { ok: true; channelId: string; diagnosis: ChannelDiagnosis | null } | { ok: false; message: string };

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
  parsed: { platform: ChannelPlatform; externalId: string; normalizedUrl: string; displayName?: string | null; thumbnailUrl?: string | null; /** Older rows stored the "@handle"; the same channel must not be added a second time under its channel id. */ alsoKnownAs?: string[] },
): Promise<TrackedChannelRow> {
  const knownIds = [parsed.externalId, ...(parsed.alsoKnownAs ?? [])];
  const { data: existingRows, error: selectError } = await supabase
    .from("tracked_channels")
    .select(TRACKED_CHANNEL_COLUMNS)
    .eq("business_id", businessId)
    .eq("platform", parsed.platform)
    .in("external_id", knownIds);
  if (selectError) throw new ChannelsError("DATABASE_ERROR", "등록된 채널을 확인하지 못했습니다.", { cause: selectError });
  const existing = (existingRows ?? []).find((row) => row.external_id === parsed.externalId) ?? existingRows?.[0];
  if (existing) return existing as TrackedChannelRow;

  const { data: inserted, error: insertError } = await supabase
    .from("tracked_channels")
    // The diagnosis right after this saves today's baseline snapshot; the daily collection (06:00 KST) continues from
    // the next 06:00. Set here because tracked_channels has no update policy for the user client.
    .insert({
      business_id: businessId,
      platform: parsed.platform,
      external_id: parsed.externalId,
      url: parsed.normalizedUrl,
      display_name: parsed.displayName ?? null,
      thumbnail_url: parsed.thumbnailUrl ?? null,
      next_snapshot_at: nextDailyCollectionAt(new Date()).toISOString(),
    })
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

  // Public lookup first: a YouTube @handle becomes its canonical channel id (so a renamed handle keeps the same history),
  // and a channel that does not exist is refused before anything is saved.
  const resolved = await resolveParsedChannel(parsed);
  if (!resolved.ok) return { ok: false, message: resolved.message };
  const { preview } = resolved;

  const supabase = await createClient();
  const channel = await findOrCreateTrackedChannel(supabase, businessId, {
    platform: preview.platform,
    externalId: preview.externalId,
    normalizedUrl: preview.normalizedUrl,
    displayName: preview.displayName,
    thumbnailUrl: preview.thumbnailUrl,
    alsoKnownAs: parsed.youtubeLookup && "handle" in parsed.youtubeLookup ? [parsed.youtubeLookup.handle] : [],
  });

  const { data: business } = await supabase.from("businesses").select("name").eq("id", businessId).maybeSingle();

  try {
    const diagnosis = await diagnoseChannel(
      { id: channel.id, business_id: businessId, external_id: channel.external_id, url: channel.url, platform: channelPlatformSchema.parse(channel.platform) },
      business?.name,
    );
    return { ok: true, channelId: channel.id, diagnosis };
  } catch (error) {
    // The channel is already saved; failing the whole registration here would leave it half-done (saved, but shown as an error).
    if (error instanceof DiagnosisRateLimitError) return { ok: true, channelId: channel.id, diagnosis: null };
    throw error;
  }
}
