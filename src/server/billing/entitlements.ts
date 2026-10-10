import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { SubscriptionPlan } from "@/types/domain";
import { logger } from "@/lib/logger";
import { getPeriodKey, getPeriodRange } from "@/lib/utils/date";
import { getPlanConfig, PLAN_LABEL } from "./plans";

type DbClient = SupabaseClient<Database>;

/** Template slugs that have their own sub-limit, and which PlanConfig field holds it. */
const CONTENT_TYPE_LIMIT_FIELD = {
  "blog-marketing": "monthlyBlogLimit",
  shorts: "monthlyShortsLimit",
} as const;

const CONTENT_TYPE_LABEL: Record<keyof typeof CONTENT_TYPE_LIMIT_FIELD, string> = {
  "blog-marketing": "블로그",
  shorts: "숏폼",
};

export interface EntitlementCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Server-side plan + limit checks. Called from Server Actions / Route
 * Handlers *before* mutating anything — the UI may also hide buttons for
 * UX, but these checks are the real gate (Rule: never trust the client).
 */

export async function getEffectivePlan(supabase: DbClient, userId: string): Promise<SubscriptionPlan> {
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
      reason: `${PLAN_LABEL[plan]} 요금제는 만들기 설정을 ${config.automationLimit}개까지 만들 수 있어요. 요금제를 올리면 더 만들 수 있어요.`,
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
    return { allowed: false, reason: `${PLAN_LABEL[plan]} 요금제에서는 이 콘텐츠를 만들 수 없어요. 요금제를 올리면 이용할 수 있어요.` };
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
      reason: `${PLAN_LABEL[plan]} 요금제의 이번 달 제작 한도(${config.monthlyRunLimit}회)를 모두 썼어요. 다음 달에 다시 쓰거나 요금제를 올려보세요.`,
    };
  }

  const contentLimitKey = (CONTENT_TYPE_LIMIT_FIELD as Record<string, "monthlyBlogLimit" | "monthlyShortsLimit">)[templateSlug];
  if (contentLimitKey) {
    const contentLimit = config[contentLimitKey];
    if (contentLimit !== null) {
      const usedForType = await getContentTypeUsage(supabase, userId, templateSlug);
      if (usedForType >= contentLimit) {
        const label = CONTENT_TYPE_LABEL[templateSlug as keyof typeof CONTENT_TYPE_LABEL];
        return {
          allowed: false,
          reason: contentLimit === 0
            ? `${PLAN_LABEL[plan]} 요금제에서는 ${label}을(를) 만들 수 없어요. 요금제를 올리면 이용할 수 있어요.`
            : `${PLAN_LABEL[plan]} 요금제의 이번 달 ${label} 한도(${contentLimit}건)를 모두 썼어요. 다음 달에 다시 쓰거나 요금제를 올려보세요.`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Counts this user's SUCCESS automation_runs for the given template slug
 * within the current calendar month. No FK embedding is available on these
 * generated types (see other two-step lookups in this codebase, e.g.
 * src/app/(app)/automations/actions.ts), so this resolves template -> the
 * user's automation ids for that template -> a count over automation_runs,
 * mirroring the same "SUCCESS only" counting rule incrementUsage uses for
 * monthlyRunLimit (see src/server/automations/runner.ts).
 */
export async function getContentTypeUsage(supabase: DbClient, userId: string, templateSlug: string): Promise<number> {
  const { data: template, error: templateError } = await supabase
    .from("automation_templates")
    .select("id")
    .eq("slug", templateSlug)
    .maybeSingle();
  if (templateError) throw templateError;
  if (!template) return 0;

  const { data: automations, error: automationsError } = await supabase
    .from("automations")
    .select("id")
    .eq("user_id", userId)
    .eq("template_id", template.id);
  if (automationsError) throw automationsError;

  const automationIds = (automations ?? []).map((a) => a.id);
  if (automationIds.length === 0) return 0;

  const { start, end } = getPeriodRange();
  const { count, error: runsError } = await supabase
    .from("automation_runs")
    .select("id", { count: "exact", head: true })
    .in("automation_id", automationIds)
    .eq("status", "SUCCESS")
    .gte("completed_at", start.toISOString())
    .lt("completed_at", end.toISOString());
  if (runsError) throw runsError;

  return count ?? 0;
}

/**
 * Whether one more "really animated" character Short fits in this month's plan
 * allowance. Counts this month's SUCCESS Shorts runs that were rendered with
 * animation clips (`output.animationMode = "video"`).
 */
export async function canUseAnimatedShorts(supabase: DbClient, userId: string): Promise<EntitlementCheck> {
  const plan = await getEffectivePlan(supabase, userId);
  const limit = getPlanConfig(plan).monthlyAnimatedShortsLimit;
  if (limit === null) return { allowed: true };
  if (limit === 0) {
    return { allowed: false, reason: `${PLAN_LABEL[plan]} 요금제에서는 움직이는 캐릭터 영상을 만들 수 없어요.` };
  }

  const { data: template } = await supabase.from("automation_templates").select("id").eq("slug", "shorts").maybeSingle();
  if (!template) return { allowed: true };
  const { data: automations, error: automationsError } = await supabase
    .from("automations")
    .select("id")
    .eq("user_id", userId)
    .eq("template_id", template.id);
  if (automationsError) throw automationsError;
  const ids = (automations ?? []).map((item) => item.id);
  if (ids.length === 0) return { allowed: true };

  const { start, end } = getPeriodRange();
  const { count, error } = await supabase
    .from("automation_runs")
    .select("id", { count: "exact", head: true })
    .in("automation_id", ids)
    .eq("status", "SUCCESS")
    .eq("output->>animationMode", "video")
    .gte("completed_at", start.toISOString())
    .lt("completed_at", end.toISOString());
  if (error) throw error;

  if ((count ?? 0) >= limit) {
    return { allowed: false, reason: `${PLAN_LABEL[plan]} 요금제의 이번 달 움직이는 캐릭터 영상 한도(${limit}건)를 모두 썼어요.` };
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
 * Increments this month's usage counters atomically through the
 * `increment_usage` RPC (0032_audit_hardening.sql) so concurrent runs can't
 * lose an increment. Falls back to the old read-then-write only when the RPC
 * doesn't exist yet (a deploy that ran before the migration did), so rolling
 * the code out ahead of the migration never breaks run bookkeeping.
 */
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
  // PGRST202 = function not found in the schema cache, 42883 = undefined_function.
  if (rpcError.code !== "PGRST202" && rpcError.code !== "42883") {
    // The generated content already exists; a bookkeeping failure must not
    // turn a successful run into a failed one. Surface it loudly instead.
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
