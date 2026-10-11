import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { CreditKind } from "./products";

/**
 * Read side of the credit ledger for screens (header, dashboard, blog/shorts pages). Reserving, settling and
 * releasing live in the runner through the atomic RPCs in ./credits — the numbers here are only what is usable now.
 */
export interface CreditBalance {
  remaining: number;
  nextExpiry: string | null;
}

/** Credits still usable right now for one kind (not expired, not reserved). */
export async function getUsableCredits(
  supabase: SupabaseClient<Database>,
  userId: string,
  kind: CreditKind,
): Promise<CreditBalance> {
  const balances = await getCreditBalances(supabase, userId);
  return balances[kind];
}

/** Usable Blog and Shorts credits in one query. */
export async function getCreditBalances(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Record<CreditKind, CreditBalance>> {
  const { data, error } = await supabase
    .from("credit_grants")
    .select("kind,remaining,expires_at")
    .eq("user_id", userId)
    .gt("remaining", 0)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true });
  if (error) throw error;
  const balances: Record<CreditKind, CreditBalance> = { BLOG: { remaining: 0, nextExpiry: null }, SHORTS: { remaining: 0, nextExpiry: null } };
  for (const grant of data ?? []) {
    balances[grant.kind].remaining += grant.remaining;
    balances[grant.kind].nextExpiry ??= grant.expires_at;
  }
  return balances;
}
