import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { ChannelsError } from "./summary";

/** "business 기준 5회/시간" — per ticket 1-5's confirmed decision. */
const HOURLY_LIMIT = 5;
const HOUR_MS = 60 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;
/** Odds of sweeping old rows on any single recordDiagnosisAttempt call — "가끔 정리", cheap enough to not need a dedicated cron. */
const CLEANUP_PROBABILITY = 0.1;

export class DiagnosisRateLimitError extends Error {
  constructor(message = "시간당 채널 진단 요청 한도를 초과했어요. 잠시 후 다시 시도해주세요.") {
    super(message);
    this.name = "DiagnosisRateLimitError";
  }
}

/** Bypasses RLS (channel_diagnosis_attempts has no delete policy — see migration 0041) since this prunes rows across whichever businesses happen to have old ones, not just the caller's own. Best-effort: a failure here never blocks the diagnosis the caller is actually trying to do. */
async function cleanupOldAttempts(now: Date): Promise<void> {
  try {
    const admin = createAdminClient();
    const cutoff = new Date(now.getTime() - RETENTION_MS).toISOString();
    const { error } = await admin.from("channel_diagnosis_attempts").delete().lt("created_at", cutoff);
    if (error) throw error;
  } catch (cause) {
    logger.warn("channel_diagnosis_attempts_cleanup_failed", { message: cause instanceof Error ? cause.message : String(cause) });
  }
}

/**
 * Enforces + records "채널당이 아니라 사업당 시간당 5회" of real diagnosis
 * collection. Callers must call this only on an actual cache miss, right
 * before calling the collector — a fresh-cache return never reaches here,
 * so it never counts against the limit (see diagnose.ts's diagnoseChannel).
 * Recording happens before the collector call, so a request that's later
 * blocked here never shows up as an attempt, but one that goes on to fail
 * downstream still does ("성공/실패 무관").
 *
 * Ticket 1-6's cron (processDueChannels) and "지금 수집" (collectChannelNow)
 * paths call snapshotChannelMetrics directly, never diagnoseChannel/this
 * function — so they are already excluded by construction, not by a guard
 * here.
 */
export async function recordDiagnosisAttempt(businessId: string, now: Date = new Date()): Promise<void> {
  const supabase = await createClient();
  const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString();

  const { count, error: countError } = await supabase
    .from("channel_diagnosis_attempts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .gte("created_at", hourAgo);
  if (countError) throw new ChannelsError("DATABASE_ERROR", "진단 요청 횟수를 확인하지 못했습니다.", { cause: countError });
  if ((count ?? 0) >= HOURLY_LIMIT) throw new DiagnosisRateLimitError();

  const { error: insertError } = await supabase.from("channel_diagnosis_attempts").insert({ business_id: businessId, created_at: now.toISOString() });
  if (insertError) throw new ChannelsError("DATABASE_ERROR", "진단 요청을 기록하지 못했습니다.", { cause: insertError });

  if (Math.random() < CLEANUP_PROBABILITY) await cleanupOldAttempts(now);
}
