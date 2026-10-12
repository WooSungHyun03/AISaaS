import "server-only";
import { serverEnv } from "@/lib/env/server";
import { BudgetError } from "./errors";
import { budgetPeriodKeyFrom } from "./period";

export type BudgetKind = "VIDEO" | "BLOG";

export interface BudgetLimits {
  kind: BudgetKind;
  /** The whole service's spend cap for the period. */
  capUsd: number;
  /** How many finished items the period may hold. */
  itemLimit: number;
  /** The most one item (one run) may spend, retries included. */
  itemCapUsd: number;
  /** The least one more item needs to be finished: held back for every item not made yet. */
  itemFloorUsd: number;
}

export function budgetLimits(kind: BudgetKind): BudgetLimits {
  return kind === "VIDEO"
    ? { kind, capUsd: serverEnv.BUDGET_VIDEO_USD, itemLimit: serverEnv.BUDGET_VIDEO_ITEMS, itemCapUsd: serverEnv.BUDGET_VIDEO_ITEM_CAP_USD, itemFloorUsd: serverEnv.BUDGET_VIDEO_ITEM_FLOOR_USD }
    : { kind, capUsd: serverEnv.BUDGET_BLOG_USD, itemLimit: serverEnv.BUDGET_BLOG_ITEMS, itemCapUsd: serverEnv.BUDGET_BLOG_ITEM_CAP_USD, itemFloorUsd: serverEnv.BUDGET_BLOG_ITEM_FLOOR_USD };
}

export function currentBudgetPeriod(now: Date = new Date()): string {
  return budgetPeriodKeyFrom({ start: serverEnv.BUDGET_PERIOD_START, end: serverEnv.BUDGET_PERIOD_END }, now);
}

/** Every paid call passes through here first: an emergency freeze or a missing opt-in stops it before anything is reserved. */
export function assertPaidCallsAllowed(): void {
  if (serverEnv.BUDGET_FREEZE === "true") throw new BudgetError("BUDGET_FROZEN", "BUDGET_FREEZE is on.");
  if (serverEnv.ALLOW_PAID_AI_CALLS !== "true") throw new BudgetError("PAID_CALLS_DISABLED", "ALLOW_PAID_AI_CALLS is not \"true\".");
}
