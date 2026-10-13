import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ChannelsError } from "./summary";
import { collectAndPersistChannel } from "./collect-pipeline";
import { channelPlatformSchema } from "./platform";
import { classifyCollectionError, recordCollectionFailure } from "./persist";
import { finishCollectionRun, startCollectionRun } from "./collection-runs";
import { kstDateString } from "./schedule";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export type CollectNowResult = { status: "collected" } | { status: "already_collected_today" } | { status: "unavailable" };

/** Checked server-side regardless of what the button's disabled state shows the user — a second click (or a second browser tab, or a replayed request) on the same KST day cannot trigger a second collection. */
async function hasSnapshotToday(supabase: SupabaseClient<Database>, channelId: string, now: Date): Promise<boolean> {
  const { data, error } = await supabase
    .from("marketing_metric_snapshots")
    .select("id")
    .eq("channel_id", channelId)
    .eq("recorded_date", kstDateString(now))
    .limit(1)
    .maybeSingle();
  if (error) throw new ChannelsError("DATABASE_ERROR", "오늘 수집 여부를 확인하지 못했습니다.", { cause: error });
  return data !== null;
}

/**
 * "지금 수집" 버튼(채널당 하루 1회 제한) — RLS already scopes `channelId`
 * to the caller's own businesses, so this never needs an explicit owner
 * check beyond that.
 */
export async function collectChannelNow(channelId: string, now: Date = new Date()): Promise<CollectNowResult> {
  const supabase = await createClient();

  const { data: channel, error: channelError } = await supabase
    .from("tracked_channels")
    .select("id, business_id, platform, external_id, url")
    .eq("id", channelId)
    .maybeSingle();
  if (channelError) throw new ChannelsError("DATABASE_ERROR", "채널 정보를 불러오지 못했습니다.", { cause: channelError });
  if (!channel) throw new ChannelsError("DATABASE_ERROR", "채널을 찾을 수 없습니다.");

  if (await hasSnapshotToday(supabase, channel.id, now)) return { status: "already_collected_today" };

  const { data: business } = await supabase.from("businesses").select("name").eq("id", channel.business_id).maybeSingle();
  const typedChannel = { ...channel, platform: channelPlatformSchema.parse(channel.platform) };
  const runId = await startCollectionRun({ trigger: "MANUAL_USER", scheduledFor: now, now });
  try {
    const saved = await collectAndPersistChannel(typedChannel, business?.name, now);
    await finishCollectionRun(runId, { total: 1, succeeded: saved.status === "SUCCESS" ? 1 : 0, failed: saved.status === "SUCCESS" ? 0 : 1, skipped: 0, quotaExceeded: false });
    return saved.status === "SUCCESS" ? { status: "collected" } : { status: "unavailable" };
  } catch (cause) {
    await recordCollectionFailure(channel.id, cause, now).catch(() => undefined);
    await finishCollectionRun(runId, { total: 1, succeeded: 0, failed: 1, skipped: 0, quotaExceeded: classifyCollectionError(cause).status === "QUOTA_EXCEEDED", errorSummary: cause instanceof Error ? cause.message : String(cause) });
    throw cause;
  }
}
