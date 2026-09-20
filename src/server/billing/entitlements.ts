import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { SubscriptionPlan } from "@/types/domain";
import { getPeriodKey } from "@/lib/utils/date";
import { getPlanConfig } from "./plans";

type DbClient = SupabaseClient<Database>;

export interface EntitlementCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Server-side plan + limit checks. Called from Server Actions / Route
 * Handlers *before* mutating anything — the UI may also hide buttons for
 * UX, but these checks are the real gate (Rule: never trust the client).
 */

async function getEffectivePlan(supabase: DbClient, userId: string): Promise<SubscriptionPlan> {
  const { data } = await supabase.from("subscriptions").select("plan, status").eq("user_id", userId).maybeSingle();

  if (!data) return "FREE";
  // A lapsed/canceled/past-due subscription loses paid entitlements
  // immediately, even if `plan` still says STARTER/PRO until the row is
  // reconciled by the next webhook event.
  if (data.status === "CANCELED" || data.status === "PAST_DUE" || data.status === "INCOMPLETE") {
    return "FREE";
  }
  return data.plan;
}

export async function canCreateAutomation(supabase: DbClient, userId: string): Promise<EntitlementCheck> {
  const plan = await getEffectivePlan(supabase, userId);
  const config = getPlanConfig(plan);

  if (config.automationLimit === null) return { allowed: true };

  const { count, error } = await supabase
    .from("automations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) throw error;

  if ((count ?? 0) >= config.automationLimit) {
    return {
      allowed: false,
      reason: `${config.name} 플랜은 자동화를 최대 ${config.automationLimit}개까지 생성할 수 있습니다.`,
    };
  }
  return { allowed: true };
}

export async function canExecuteAutomation(
  supabase: DbClient,
  userId: string,
  templateSlug: string,
): Promise<EntitlementCheck> {
  const plan = await getEffectivePlan(supabase, userId);
  const config = getPlanConfig(plan);

  if (config.allowedTemplateSlugs && !config.allowedTemplateSlugs.includes(templateSlug)) {
    return { allowed: false, reason: `${config.name} 플랜에서는 이 자동화 유형을 실행할 수 없습니다.` };
  }

  if (config.monthlyRunLimit === null) return { allowed: true };

  const period = getPeriodKey();
  const { data: usage } = await supabase
    .from("usage")
    .select("automation_runs")
    .eq("user_id", userId)
    .eq("period", period)
    .maybeSingle();

  const used = usage?.automation_runs ?? 0;
  if (used >= config.monthlyRunLimit) {
    return {
      allowed: false,
      reason: `${config.name} 플랜의 이번 달 실행 한도(${config.monthlyRunLimit}회)를 모두 사용했습니다.`,
    };
  }
  return { allowed: true };
}

export async function getAutomationLimit(plan: SubscriptionPlan): Promise<number | null> {
  return getPlanConfig(plan).automationLimit;
}

export async function getMonthlyRunLimit(plan: SubscriptionPlan): Promise<number | null> {
  return getPlanConfig(plan).monthlyRunLimit;
}

/**
 * Increments this month's usage counters. Read-then-write, not atomic —
 * acceptable at MVP scale (a handful of runs per user per day). If
 * concurrent runs per user become common, replace with a Postgres RPC
 * that does `insert ... on conflict do update set x = x + 1`.
 */
export async function incrementUsage(
  admin: DbClient,
  userId: string,
  delta: { automationRuns?: number; aiGenerations?: number },
): Promise<void> {
  const period = getPeriodKey();
  const { data: existing } = await admin
    .from("usage")
    .select("id, automation_runs, ai_generations")
    .eq("user_id", userId)
    .eq("period", period)
    .maybeSingle();

  if (!existing) {
    await admin.from("usage").insert({
      user_id: userId,
      period,
      automation_runs: delta.automationRuns ?? 0,
      ai_generations: delta.aiGenerations ?? 0,
    });
    return;
  }

  await admin
    .from("usage")
    .update({
      automation_runs: existing.automation_runs + (delta.automationRuns ?? 0),
      ai_generations: existing.ai_generations + (delta.aiGenerations ?? 0),
    })
    .eq("id", existing.id);
}
