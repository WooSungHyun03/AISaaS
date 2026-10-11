import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { SubscriptionPlan } from "@/types/domain";
import { logger } from "@/lib/logger";
import { getPeriodKey } from "@/lib/utils/date";
import { getPlanConfig, PLAN_LABEL } from "./plans";
import type { CreditKind } from "./products";

type DbClient = SupabaseClient<Database>;

export const CREDIT_EXHAUSTED_MESSAGE = "이용권이 없거나 모두 만료됐어요. 이용권을 구매하면 바로 만들 수 있어요.";

const CREDIT_KIND_BY_TEMPLATE: Readonly<Record<string, CreditKind | undefined>> = {
  "blog-marketing": "BLOG",
  shorts: "SHORTS",
};

export function getAutomationCreditKind(templateSlug: string): CreditKind | null {
  return CREDIT_KIND_BY_TEMPLATE[templateSlug] ?? null;
}

export interface EntitlementCheck {
  allowed: boolean;
  reason?: string;
  /** Animated Shorts still use the legacy plan's provider quality setting. */
  animationQuality?: "standard" | "premium";
}

export async function getEffectivePlan(supabase: DbClient, userId: string): Promise<SubscriptionPlan> {
  const { data } = await supabase.from("subscriptions").select("plan, status").eq("user_id", userId).maybeSingle();
  if (!data || data.status === "CANCELED" || data.status === "PAST_DUE" || data.status === "INCOMPLETE") return "FREE";
  return data.plan;
}

/** Legacy automation-count limits remain until automation setup itself moves to products. */
export async function canCreateAutomation(supabase: DbClient, userId: string): Promise<EntitlementCheck> {
  const plan = await getEffectivePlan(supabase, userId);
  const config = getPlanConfig(plan);
  if (config.automationLimit === null) return { allowed: true };

  const { count, error } = await supabase.from("automations").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw error;
  if ((count ?? 0) >= config.automationLimit) {
    return {
      allowed: false,
      reason: `${PLAN_LABEL[plan]} 요금제는 만들기 설정을 ${config.automationLimit}개까지 만들 수 있어요.`,
    };
  }
  return { allowed: true };
}

/**
 * Execution entitlement is now only an unexpired balance check. The runner
 * repeats this check and atomically reserves a credit, so a direct Server
 * Action call or two concurrent requests cannot bypass billing.
 */
export async function canExecuteAutomation(
  supabase: DbClient,
  userId: string,
  templateSlug: string,
): Promise<EntitlementCheck> {
  const kind = getAutomationCreditKind(templateSlug);
  if (!kind) return { allowed: true };

  const { data, error } = await supabase
    .from("credit_grants")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", kind)
    .gt("remaining", 0)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { allowed: true } : { allowed: false, reason: CREDIT_EXHAUSTED_MESSAGE };
}

/**
 * Animation model selection remains a legacy-plan quality choice. Content
 * execution itself is governed only by Shorts credits and has no monthly cap.
 */
export async function canUseAnimatedShorts(supabase: DbClient, userId: string): Promise<EntitlementCheck> {
  const plan = await getEffectivePlan(supabase, userId);
  return { allowed: true, animationQuality: getPlanConfig(plan).animationQuality };
}

export async function getAutomationLimit(plan: SubscriptionPlan): Promise<number | null> {
  return getPlanConfig(plan).automationLimit;
}

/** Legacy usage rows remain as analytics; they no longer authorize execution. */
export async function incrementUsage(
  admin: DbClient,
  userId: string,
  delta: { automationRuns?: number; aiGenerations?: number },
): Promise<void> {
  const period = getPeriodKey();
  const runs = delta.automationRuns ?? 0;
  const generations = delta.aiGenerations ?? 0;
  const { error: rpcError } = await admin.rpc("increment_usage", {
    p_user_id: userId,
    p_period: period,
    p_runs: runs,
    p_generations: generations,
  });
  if (!rpcError) return;
  if (rpcError.code !== "PGRST202" && rpcError.code !== "42883") {
    logger.error("usage_increment_failed", { userId, period, code: rpcError.code });
    return;
  }

  const { data: existing } = await admin
    .from("usage")
    .select("id, automation_runs, ai_generations")
    .eq("user_id", userId)
    .eq("period", period)
    .maybeSingle();
  if (!existing) {
    await admin.from("usage").insert({ user_id: userId, period, automation_runs: runs, ai_generations: generations });
    return;
  }
  await admin
    .from("usage")
    .update({ automation_runs: existing.automation_runs + runs, ai_generations: existing.ai_generations + generations })
    .eq("id", existing.id);
}
