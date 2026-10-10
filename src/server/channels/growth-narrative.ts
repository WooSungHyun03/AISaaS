import "server-only";
import { createClient } from "@/lib/supabase/server";
import { generateText } from "@/server/ai/generate";
import { stripUnverifiedNumbers } from "@/server/shared/ai-number-guard";
import { ChannelsError } from "./summary";
import { kstDate } from "./growth-series";
import type { ChannelGrowthSeries } from "./growth-series";
import type { Business } from "@/types/domain";

export interface GrowthNarrativeResult {
  narrative: string;
  /** False when the AI step failed, or every sentence it wrote got stripped by ai-number-guard — `narrative` falls back to the rule-based summary either way. */
  aiUsed: boolean;
}

/** Deterministic, always available — used when the AI step fails or gets fully stripped. */
function buildRuleBasedNarrative(channel: ChannelGrowthSeries): string {
  const sentences: string[] = [];
  for (const metric of channel.metrics) {
    if (metric.status === "COLLECTING") {
      sentences.push(`${metric.label}은 아직 데이터를 모으는 중이에요.`);
    } else if (metric.current === null) {
      continue;
    } else if (metric.absoluteDelta === null) {
      sentences.push(`${metric.label}은 지금 ${metric.current}이에요. 비교할 이전 기간 데이터가 없어요.`);
    } else {
      const sign = metric.absoluteDelta > 0 ? "+" : "";
      sentences.push(`${metric.label}이 이전 기간보다 ${sign}${metric.absoluteDelta} 변해서 지금 ${metric.current}이에요.`);
    }
  }
  return sentences.join(" ") || "아직 비교할 만한 데이터가 쌓이지 않았어요.";
}

/** Exactly what the prompt below embeds — ai-number-guard checks the AI's response against this same string. */
function buildAllowedSourceText(channel: ChannelGrowthSeries): string {
  return JSON.stringify(
    channel.metrics.map((metric) => ({
      metric: metric.metric,
      status: metric.status,
      current: metric.current,
      previous: metric.previous,
      absoluteDelta: metric.absoluteDelta,
      deltaPercent: metric.deltaPercent,
    })),
  );
}

function buildNarrativePrompt(channel: ChannelGrowthSeries, business: Pick<Business, "name" | "industry">, days: number) {
  const system = [
    "당신은 한국 소상공인을 위한 채널 성장 코치입니다.",
    "아래 GROWTH_DATA는 이미 계산이 끝난 변화량입니다 — 숫자를 새로 만들거나 추측하지 마세요.",
    "GROWTH_DATA에 없는 숫자는 절대 언급하지 마세요. 비교할 이전 값이 없는(previous가 null인) 지표는 퍼센트나 증감을 말하지 말고 '아직 비교할 데이터가 없다'고만 쓰세요.",
  ].join("\n");

  const prompt = [
    `사업체명: ${business.name}`,
    business.industry ? `업종: ${business.industry}` : null,
    `채널: ${channel.platform}`,
    `최근 ${days}일 기준입니다.`,
    "다음 변화량 데이터를 바탕으로, 사장님께 보여줄 다정하고 구체적인 해석과 제안을 한국어 2~3문장으로 써주세요.",
    "오직 GROWTH_DATA에 있는 수치만 언급하세요.",
    "===GROWTH_DATA_START===",
    buildAllowedSourceText(channel),
    "===GROWTH_DATA_END===",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
}

/** The AI step only — no caching. See getOrCreateGrowthNarrative for the cached entry point actually used by the page. */
export async function buildGrowthNarrative(channel: ChannelGrowthSeries, business: Pick<Business, "name" | "industry">, days: number): Promise<GrowthNarrativeResult> {
  const ruleBased = buildRuleBasedNarrative(channel);

  let verified: string | null = null;
  try {
    const { system, prompt } = buildNarrativePrompt(channel, business, days);
    const raw = await generateText({ system, prompt, maxTokens: 300 });
    verified = stripUnverifiedNumbers(raw, buildAllowedSourceText(channel)) || null;
  } catch {
    verified = null;
  }

  return { narrative: verified ?? ruleBased, aiUsed: verified !== null };
}

type NarrativeRow = { narrative: string; ai_used: boolean; created_at: string };

/**
 * Cached entry point (ticket 1-7): calling the AI on every growth-report
 * page load would be slow and costly across 3 periods x N channels, so
 * this reuses the newest row for (channelId, days) if it was generated
 * today (KST) — same "insert-only, caller picks the newest row" idiom as
 * diagnoseChannel's 1-hour cache, just day-grained instead of hour-grained
 * (see migration 0042's comment for why insert-only, not upsert).
 */
export async function getOrCreateGrowthNarrative(
  trackedChannel: { id: string; business_id: string },
  channel: ChannelGrowthSeries,
  business: Pick<Business, "name" | "industry">,
  days: number,
  now: Date = new Date(),
): Promise<GrowthNarrativeResult> {
  const supabase = await createClient();

  const { data: latest, error: selectError } = await supabase
    .from("channel_growth_narratives")
    .select("narrative, ai_used, created_at")
    .eq("channel_id", trackedChannel.id)
    .eq("days", days)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selectError) throw new ChannelsError("DATABASE_ERROR", "기존 성장 해석을 확인하지 못했습니다.", { cause: selectError });

  const cached = latest as NarrativeRow | null;
  if (cached && kstDate(Date.parse(cached.created_at)) === kstDate(now.getTime())) {
    return { narrative: cached.narrative, aiUsed: cached.ai_used };
  }

  const fresh = await buildGrowthNarrative(channel, business, days);

  const { error: insertError } = await supabase.from("channel_growth_narratives").insert({
    business_id: trackedChannel.business_id,
    channel_id: trackedChannel.id,
    days,
    narrative: fresh.narrative,
    ai_used: fresh.aiUsed,
  });
  if (insertError) throw new ChannelsError("DATABASE_ERROR", "성장 해석을 저장하지 못했습니다.", { cause: insertError });

  return fresh;
}
