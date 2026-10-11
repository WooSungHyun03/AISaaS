import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { FREE_TRIAL_CREDITS, type CreditKind } from "./products";

function requireRpcResult<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw error;
  if (data === null) throw new Error("Credit RPC returned no result.");
  return data;
}

export async function grantCredit(params: {
  userId: string;
  kind: CreditKind;
  amount: number;
  expiresAt: Date | string;
  orderId?: string | null;
  referenceId?: string | null;
}): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("grant_credit", {
    p_user_id: params.userId,
    p_kind: params.kind,
    p_amount: params.amount,
    p_expires_at: params.expiresAt instanceof Date ? params.expiresAt.toISOString() : params.expiresAt,
    p_order_id: params.orderId ?? null,
    p_reference_id: params.referenceId ?? null,
  });
  return requireRpcResult(data, error);
}

export async function reserveCredit(params: {
  userId: string;
  kind: CreditKind;
  amount?: number;
  referenceId?: string | null;
}): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reserve_credit", {
    p_user_id: params.userId,
    p_kind: params.kind,
    p_amount: params.amount ?? 1,
    p_reference_id: params.referenceId ?? null,
  });
  return requireRpcResult(data, error);
}

export async function settleCredit(reservationId: string, referenceId?: string | null): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("settle_credit", {
    p_reservation_id: reservationId,
    p_reference_id: referenceId ?? null,
  });
  if (error) throw error;
}

export async function releaseCredit(reservationId: string, reason?: string | null): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("release_credit", {
    p_reservation_id: reservationId,
    p_reason: reason ?? null,
  });
  if (error) throw error;
}

export async function releaseCreditByReference(referenceId: string, reason?: string | null): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("release_credit_by_reference", {
    p_reference_id: referenceId,
    p_reason: reason ?? null,
  });
  return requireRpcResult(data, error);
}

export async function settleCreditByReference(referenceId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("settle_credit_by_reference", {
    p_reference_id: referenceId,
  });
  return requireRpcResult(data, error);
}

export function isInsufficientCreditError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown };
  return value.code === "P0001" || (typeof value.message === "string" && /insufficient (BLOG|SHORTS) credits/i.test(value.message));
}

/** Grants the configured signup trial once. Safe to call on every first-party entry point. */
export async function ensureTrialCredits(userId: string, now = new Date()): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + FREE_TRIAL_CREDITS.validityDays * 24 * 60 * 60 * 1_000);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ensure_trial_credits", {
    p_user_id: userId,
    p_blog_amount: FREE_TRIAL_CREDITS.amounts.BLOG,
    p_shorts_amount: FREE_TRIAL_CREDITS.amounts.SHORTS,
    p_expires_at: expiresAt.toISOString(),
    p_reference_id: FREE_TRIAL_CREDITS.referenceId,
  });
  return requireRpcResult(data, error);
}

export async function expireCredits(now = new Date()): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("expire_credits", { p_now: now.toISOString() });
  return requireRpcResult(data, error);
}

export async function refundOrderCredits(orderId: string, reason?: string | null): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("refund_order_credits", {
    p_order_id: orderId,
    p_reason: reason ?? null,
  });
  return requireRpcResult(data, error);
}

