import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { BudgetKind } from "./config";

/**
 * Which pipeline and run the paid calls inside a function belong to. A handler wraps its work in `withBudgetScope`;
 * the AI layer reads it, so a prompt helper never has to know about money, and a paid call made outside any scope is
 * refused instead of going unmetered.
 */
export interface BudgetScope {
  kind: BudgetKind;
  runId: string | null;
  /** 1 for the first try of the run's main work, 2 for the one allowed regeneration. */
  attempt: number;
}

const storage = new AsyncLocalStorage<BudgetScope>();

export function withBudgetScope<T>(scope: BudgetScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function currentBudgetScope(): BudgetScope | undefined {
  return storage.getStore();
}
