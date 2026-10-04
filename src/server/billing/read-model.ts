import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getPeriodKey } from "@/lib/utils/date";
import { getContentTypeUsage } from "./entitlements";

export async function getBillingOverview(userId: string) {
  const supabase = await createClient();
  const [subscriptionResult, usageResult, automationResult] = await Promise.all([
    supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("usage").select("*").eq("user_id", userId).eq("period", getPeriodKey()).maybeSingle(),
    supabase.from("automations").select("id", { count: "exact", head: true }).eq("user_id", userId),
  ]);

  if (subscriptionResult.error) throw subscriptionResult.error;
  if (usageResult.error) throw usageResult.error;
  if (automationResult.error) throw automationResult.error;

  const [blogUsed, shortsUsed] = await Promise.all([
    getContentTypeUsage(supabase as never, userId, "blog-marketing"),
    getContentTypeUsage(supabase as never, userId, "shorts"),
  ]);

  return {
    subscription: subscriptionResult.data,
    usage: usageResult.data,
    automationCount: automationResult.count ?? 0,
    contentUsage: { blog: blogUsed, shorts: shortsUsed },
  };
}

export async function getSubscriptionForUser(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("plan,status,current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
