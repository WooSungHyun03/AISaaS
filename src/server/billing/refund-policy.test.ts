import { describe, expect, it } from "vitest";
import { calculateRefundQuote, REFUND_POLICY } from "./refund-policy";

const now = new Date("2026-10-11T00:00:00.000Z");
const future = "2026-11-10T00:00:00.000Z";

describe("refund policy", () => {
  it("returns the unused-credit share of the paid price", () => {
    expect(calculateRefundQuote({ creditAmount: 5, remainingCredits: 3, priceKrw: 9_900, expiresAt: future, now })).toEqual({
      eligible: true,
      reason: null,
      usedCredits: 2,
      unusedCredits: 3,
      expectedRefundKrw: 5_940,
      policySnapshot: { unusedCreditRefundRate: REFUND_POLICY.unusedCreditRefundRate, validityBasis: "credit-grant-expiry", creditExpiresAt: future },
    });
  });

  it("rounds down partial won amounts", () => {
    const quote = calculateRefundQuote({ creditAmount: 3, remainingCredits: 2, priceKrw: 10_000, expiresAt: future, now });
    expect(quote.expectedRefundKrw).toBe(6_666);
  });

  it("rejects expired or fully used credits", () => {
    expect(calculateRefundQuote({ creditAmount: 5, remainingCredits: 5, priceKrw: 9_900, expiresAt: now.toISOString(), now })).toMatchObject({ eligible: false, expectedRefundKrw: 0 });
    expect(calculateRefundQuote({ creditAmount: 5, remainingCredits: 0, priceKrw: 9_900, expiresAt: future, now })).toMatchObject({ eligible: false, expectedRefundKrw: 0, unusedCredits: 0 });
  });

  it("caps an inconsistent remaining balance at the purchased amount", () => {
    expect(calculateRefundQuote({ creditAmount: 5, remainingCredits: 99, priceKrw: 9_900, expiresAt: future, now })).toMatchObject({ eligible: true, usedCredits: 0, unusedCredits: 5, expectedRefundKrw: 9_900 });
  });
});
