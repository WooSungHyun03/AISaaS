"use server";

import { getAuthUser, createClient } from "@/lib/supabase/server";
import { isGrowthPeriod } from "@/lib/growth/select";
import { getChannelGrowthSeries, getOrCreateGrowthNarrative } from "@/server/channels";
import { logger } from "@/lib/logger";

export interface GrowthNarrativeResult {
  narrative?: string;
  aiUsed?: boolean;
  error?: string;
}

/**
 * The AI reading for one channel and period, generated in the background after the report is already on screen (the page
 * itself never waits for the AI). The answer is cached for the day, so asking again costs nothing. Only the owner of the
 * channel can ask: both reads below run under the caller's RLS.
 */
export async function loadGrowthNarrative(channelId: string, days: number): Promise<GrowthNarrativeResult> {
  if (!isGrowthPeriod(days) || typeof channelId !== "string" || channelId.length > 64) return { error: "기간을 확인해주세요." };
  const user = await getAuthUser();
  if (!user) return { error: "로그인이 필요합니다." };

  try {
    const supabase = await createClient();
    const { data: channel } = await supabase.from("tracked_channels").select("id, business_id").eq("id", channelId).maybeSingle();
    if (!channel) return { error: "채널을 찾을 수 없습니다." };
    const [{ data: business }, series] = await Promise.all([
      supabase.from("businesses").select("name, industry").eq("id", channel.business_id).maybeSingle(),
      getChannelGrowthSeries(channel.business_id, { days }),
    ]);
    const own = series.channels.find((item) => item.channelId === channelId);
    if (!business || !own) return { error: "채널을 찾을 수 없습니다." };
    const result = await getOrCreateGrowthNarrative({ id: channel.id, business_id: channel.business_id }, own, business, days);
    return { narrative: result.narrative, aiUsed: result.aiUsed };
  } catch (error) {
    logger.warn("growth_narrative_failed", { channelId, days, message: error instanceof Error ? error.message : String(error) });
    return { error: "해석을 불러오지 못했어요." };
  }
}
