import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getPeriodKey } from "@/lib/utils/date";
import { ensureTrialCredits } from "./credits";

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

  return {
    subscription: subscriptionResult.data,
    usage: usageResult.data,
    automationCount: automationResult.count ?? 0,
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

export async function getCreditBillingOverview(userId: string) {
  await ensureTrialCredits(userId);
  const supabase = await createClient();
  const now = new Date().toISOString();
  const [grantsResult, ordersResult, subscriptionResult] = await Promise.all([
    supabase
      .from("credit_grants")
      .select("kind,remaining,expires_at")
      .eq("user_id", userId)
      .gt("remaining", 0)
      .gt("expires_at", now)
      .order("expires_at", { ascending: true }),
    supabase
      .from("billing_orders")
      .select("id,product_id,kind,credit_amount,price_krw,status,provider,paid_at,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("subscriptions")
      .select("plan,status,current_period_end")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (grantsResult.error) throw grantsResult.error;
  if (ordersResult.error) throw ordersResult.error;
  if (subscriptionResult.error) throw subscriptionResult.error;

  const balances = grantsResult.data.reduce(
    (result, grant) => {
      result[grant.kind].remaining += grant.remaining;
      result[grant.kind].nextExpiry ??= grant.expires_at;
      return result;
    },
    {
      BLOG: { remaining: 0, nextExpiry: null as string | null },
      SHORTS: { remaining: 0, nextExpiry: null as string | null },
    },
  );

  return {
    balances,
    orders: ordersResult.data,
    legacySubscription: subscriptionResult.data,
  };
}

export interface CreditLedgerEntry {
  id: string;
  kind: "BLOG" | "SHORTS";
  eventType: "GRANT" | "RESERVE" | "RELEASE" | "EXPIRE" | "REFUND";
  delta: number;
  createdAt: string;
}

/**
 * The owner's credit movements, newest first. SETTLE rows carry no change
 * (the credit was already taken at RESERVE), so they are left out.
 */
export async function getCreditLedger(userId: string, limit = 30): Promise<CreditLedgerEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("credit_ledger")
    .select("id,kind,event_type,delta,created_at")
    .eq("user_id", userId)
    .neq("event_type", "SETTLE")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    kind: row.kind as CreditLedgerEntry["kind"],
    eventType: row.event_type as CreditLedgerEntry["eventType"],
    delta: row.delta,
    createdAt: row.created_at,
  }));
}
