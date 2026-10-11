import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { logger } from "@/lib/logger";
import { releaseCredit, reserveCredit, settleCredit } from "./credits";
import type { CreditKind } from "./products";
import type { EntitlementCheck } from "./entitlements";

/**
 * Pay-per-use gate for generation. Blog and Shorts runs each consume one
 * credit of their own kind; everything else keeps its plain plan rules.
 *
 *   reserve (before the run row exists) -> settle (content saved) | release (run failed)
 *
 * The reservation id is stored on the run (`input.creditReservationId`) so a
 * resumed or reaped run can still finish the same reservation.
 */
const CREDIT_KIND_BY_TEMPLATE: Record<string, CreditKind> = {
  "blog-marketing": "BLOG",
  shorts: "SHORTS",
};

const KIND_LABEL: Record<CreditKind, string> = { BLOG: "블로그", SHORTS: "숏폼" };

export function creditKindForTemplate(templateSlug: string): CreditKind | null {
  return CREDIT_KIND_BY_TEMPLATE[templateSlug] ?? null;
}

export function insufficientCreditsMessage(kind: CreditKind): string {
  return `${KIND_LABEL[kind]} 이용권이 없거나 모두 만료됐어요. 이용권을 구매하면 바로 만들 수 있어요.`;
}

export class InsufficientCreditsError extends Error {
  constructor(public readonly kind: CreditKind) {
    super(insufficientCreditsMessage(kind));
    this.name = "InsufficientCreditsError";
  }
}

/** Reserves one credit for a run, or returns null when the template is not credit-metered. */
export async function reserveRunCredit(userId: string, templateSlug: string, runId: string): Promise<string | null> {
  const kind = creditKindForTemplate(templateSlug);
  if (!kind) return null;
  try {
    return await reserveCredit({ userId, kind, amount: 1, referenceId: runId });
  } catch (error) {
    // P0001: the RPC raised "insufficient credits"; nothing was taken.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P0001") {
      throw new InsufficientCreditsError(kind);
    }
    throw error;
  }
}

/** Makes a successful run's charge final. A bookkeeping failure never undoes the content that was made. */
export async function settleRunCredit(reservationId: string | null | undefined, runId: string): Promise<void> {
  if (!reservationId) return;
  try {
    await settleCredit(reservationId, runId);
  } catch (error) {
    logger.error("credit_settle_failed", { runId, message: error instanceof Error ? error.message : String(error) });
  }
}

/** Gives the credit back after a failed run. Safe to call twice. */
export async function releaseRunCredit(reservationId: string | null | undefined, runId: string, reason: string): Promise<void> {
  if (!reservationId) return;
  try {
    await releaseCredit(reservationId, reason);
  } catch (error) {
    logger.error("credit_release_failed", { runId, message: error instanceof Error ? error.message : String(error) });
  }
}

export function readCreditReservationId(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>).creditReservationId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Credits still usable right now for one kind (not expired, not reserved). */
export async function getUsableCredits(
  supabase: SupabaseClient<Database>,
  userId: string,
  kind: CreditKind,
): Promise<{ remaining: number; nextExpiry: string | null }> {
  const { data, error } = await supabase
    .from("credit_grants")
    .select("remaining,expires_at")
    .eq("user_id", userId)
    .eq("kind", kind)
    .gt("remaining", 0)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  return { remaining: rows.reduce((sum, row) => sum + row.remaining, 0), nextExpiry: rows[0]?.expires_at ?? null };
}

/**
 * Read-only pre-check for friendly early errors. The runner's reservation is
 * what actually protects the balance; this only avoids starting work that
 * would be refused a moment later.
 */
export async function checkRunCredits(
  supabase: SupabaseClient<Database>,
  userId: string,
  templateSlug: string,
): Promise<EntitlementCheck> {
  const kind = creditKindForTemplate(templateSlug);
  if (!kind) return { allowed: true };
  const { remaining } = await getUsableCredits(supabase, userId, kind);
  if (remaining > 0) return { allowed: true };
  return { allowed: false, reason: insufficientCreditsMessage(kind) };
}
