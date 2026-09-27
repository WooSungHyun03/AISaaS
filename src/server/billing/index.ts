import "server-only";
import { serverEnv } from "@/lib/env/server";
import type { BillingProvider } from "./provider";
import { MockBillingProvider } from "./providers/mock";
import { TossBillingProvider } from "./providers/toss";

/** Picks the active BillingProvider based on BILLING_PROVIDER. */
export function getBillingProvider(): BillingProvider {
  switch (serverEnv.BILLING_PROVIDER) {
    case "toss":
      return new TossBillingProvider();
    case "mock":
    default:
      return new MockBillingProvider();
  }
}

export * from "./provider";
export * from "./plans";
export * from "./entitlements";
