import { BudgetError } from "./errors";

export interface PeriodConfig {
  start?: string;
  end?: string;
}

/** Midnight of a calendar date in Korea (the service's time zone). */
function seoulMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00+09:00`);
}

/**
 * The key of the operating period the ledger is kept under: `start..end` (end exclusive). It is set explicitly by
 * the operator — there is no calendar-month default, so nothing resets by surprise on the 1st, and a period that is
 * not set (or already over) refuses paid work instead of guessing.
 */
export function budgetPeriodKeyFrom(config: PeriodConfig, now: Date = new Date()): string {
  if (!config.start || !config.end) {
    throw new BudgetError("BUDGET_NOT_CONFIGURED", "BUDGET_PERIOD_START and BUDGET_PERIOD_END must be set before paid generation can run.");
  }
  const start = seoulMidnight(config.start);
  const end = seoulMidnight(config.end);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    throw new BudgetError("BUDGET_NOT_CONFIGURED", `Invalid budget period ${config.start}..${config.end}.`);
  }
  if (now.getTime() < start || now.getTime() >= end) {
    throw new BudgetError("BUDGET_PERIOD_CLOSED", `Outside the budget period ${config.start}..${config.end}.`);
  }
  return `${config.start}..${config.end}`;
}
