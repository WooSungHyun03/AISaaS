import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ChannelsError } from "./summary";

export type RemoveChannelResult = { status: "removed" } | { status: "not_found" };

/**
 * "채널 삭제" — stops tracking a channel and deletes its diagnoses, metric
 * snapshots and growth narratives (all `on delete cascade` from
 * tracked_channels). tracked_channels has no delete policy (0034), so the row
 * is first read through the caller's RLS-scoped client (own businesses only)
 * and only that exact (id, business_id) pair is deleted with the service role.
 */
export async function removeTrackedChannel(channelId: string): Promise<RemoveChannelResult> {
  const supabase = await createClient();
  const { data: channel, error: channelError } = await supabase
    .from("tracked_channels")
    .select("id, business_id")
    .eq("id", channelId)
    .maybeSingle();
  if (channelError) throw new ChannelsError("DATABASE_ERROR", "채널 정보를 불러오지 못했습니다.", { cause: channelError });
  if (!channel) return { status: "not_found" };

  const { error: deleteError } = await createAdminClient()
    .from("tracked_channels")
    .delete()
    .eq("id", channel.id)
    .eq("business_id", channel.business_id);
  if (deleteError) throw new ChannelsError("DATABASE_ERROR", "채널을 삭제하지 못했습니다.", { cause: deleteError });
  return { status: "removed" };
}
