import "server-only";
import { createClient } from "@/lib/supabase/server";
import { ChannelsError } from "./summary";
import type { ChannelSnapshotSource } from "./snapshot-source";

/**
 * Upserts one (channel, metric, KST day) snapshot — "같은 날 두 번 수집해도
 * 스냅샷 1건" (0038's `marketing_metric_snapshots_channel_metric_date_key`
 * unique constraint on the generated `recorded_date` column, which Postgres
 * computes as KST). A same-day re-collection overwrites with the newer
 * value/source rather than failing or duplicating.
 *
 * `source` is typed as `ChannelSnapshotSource` ("live" | "mock") — there is
 * no code path in this signature that can write "DEMO_SEED"; that value
 * only ever reaches the table via scripts/seed-growth-demo.sql's raw SQL.
 */
export async function saveMetricSnapshot(params: {
  channelId: string;
  metric: string;
  value: number;
  source: ChannelSnapshotSource;
  recordedAt?: Date;
}): Promise<void> {
  const supabase = await createClient();
  const recordedAt = params.recordedAt ?? new Date();

  const { error } = await supabase.from("marketing_metric_snapshots").upsert(
    {
      channel_id: params.channelId,
      metric: params.metric,
      value: params.value,
      source: params.source,
      recorded_at: recordedAt.toISOString(),
    },
    { onConflict: "channel_id,metric,recorded_date" },
  );
  if (error) throw new ChannelsError("DATABASE_ERROR", "채널 지표 스냅샷을 저장하지 못했습니다.", { cause: error });
}
