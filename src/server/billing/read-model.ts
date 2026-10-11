import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getPeriodKey } from "@/lib/utils/date";
import type { AutomationRunStatus, CreditLedgerEvent } from "@/types/domain";
import { ensureTrialCredits } from "./credits";
import type { CreditKind } from "./products";

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

export type UsageHistoryStatusFilter = "SUCCESS" | "FAILED" | "RUNNING" | "GRANTED" | "RETURNED" | "EXPIRED" | "REFUNDED";

export interface UsageHistoryFilters {
  kind: CreditKind | null;
  status: UsageHistoryStatusFilter | null;
  from: string | null;
  to: string | null;
}

export interface UsageHistoryItem {
  id: string;
  kind: CreditKind;
  eventType: CreditLedgerEvent;
  delta: number;
  createdAt: string;
  terminalEvent: "SETTLE" | "RELEASE" | null;
  terminalDelta: number | null;
  runId: string | null;
  runStatus: AutomationRunStatus | null;
  automationId: string | null;
  automationName: string | null;
  contentHistoryId: string | null;
  contentTitle: string | null;
  externalUrl: string | null;
}

const USAGE_PAGE_SIZE = 20;

/**
 * Returns one customer-facing row per ledger activity. A generation's
 * RESERVE and terminal SETTLE/RELEASE stay together, preventing duplicate
 * history rows while keeping the immutable ledger as the source of truth.
 */
export async function getUsageHistory(filters: UsageHistoryFilters, page: number) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_usage_history", {
    p_page: Math.max(1, page),
    p_page_size: USAGE_PAGE_SIZE,
    p_kind: filters.kind,
    p_status: filters.status,
    p_from: filters.from,
    p_to: filters.to,
  });
  if (error) throw new Error("이용내역을 불러오지 못했습니다.", { cause: error });

  const items: UsageHistoryItem[] = (data ?? []).map((row) => ({
    id: row.ledger_id,
    kind: row.kind,
    eventType: row.event_type,
    delta: row.delta,
    createdAt: row.created_at,
    terminalEvent: row.terminal_event,
    terminalDelta: row.terminal_delta,
    runId: row.run_id,
    runStatus: row.run_status,
    automationId: row.automation_id,
    automationName: row.automation_name,
    contentHistoryId: row.content_history_id,
    contentTitle: row.content_title,
    externalUrl: row.external_url,
  }));
  return { items, total: Number(data?.[0]?.total_count ?? 0), pageSize: USAGE_PAGE_SIZE };
}
