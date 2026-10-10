import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ChannelsError } from "./summary";
import { snapshotChannelMetrics } from "./collect-pipeline";
import { channelPlatformSchema } from "./platform";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

export type CollectNowResult = { status: "collected" } | { status: "already_collected_today" };

function kstDateString(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

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
  await snapshotChannelMetrics({ ...channel, platform: channelPlatformSchema.parse(channel.platform) }, business?.name, now);
  return { status: "collected" };
}
