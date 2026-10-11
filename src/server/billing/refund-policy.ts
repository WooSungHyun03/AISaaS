import "server-only";

/**
 * Demo refund policy. Change the ratio here when the final policy is decided;
 * request rows preserve the policy value that was applied when submitted.
 */
export const REFUND_POLICY = {
  unusedCreditRefundRate: 1,
  validityBasis: "credit-grant-expiry",
} as const;

interface RefundQuoteInput {
  creditAmount: number;
  remainingCredits: number;
  priceKrw: number;
  expiresAt: string | null;
  now?: Date;
}

export type RefundQuote =
  | { eligible: false; reason: string; usedCredits: number; unusedCredits: number; expectedRefundKrw: 0 }
  | {
      eligible: true;
      reason: null;
      usedCredits: number;
      unusedCredits: number;
      expectedRefundKrw: number;
      policySnapshot: {
        unusedCreditRefundRate: number;
        validityBasis: typeof REFUND_POLICY.validityBasis;
        creditExpiresAt: string;
      };
    };

export function calculateRefundQuote({ creditAmount, remainingCredits, priceKrw, expiresAt, now = new Date() }: RefundQuoteInput): RefundQuote {
  const safeAmount = Math.max(0, Math.trunc(creditAmount));
  const unusedCredits = Math.min(safeAmount, Math.max(0, Math.trunc(remainingCredits)));
  const usedCredits = Math.max(0, safeAmount - unusedCredits);
  const unavailable = (reason: string): RefundQuote => ({ eligible: false, reason, usedCredits, unusedCredits, expectedRefundKrw: 0 });

  if (safeAmount === 0 || priceKrw < 0) return unavailable("주문 정보를 확인할 수 없어요.");
  if (!expiresAt || Number.isNaN(Date.parse(expiresAt))) return unavailable("이용권 유효기간을 확인할 수 없어요.");
  if (Date.parse(expiresAt) <= now.getTime()) return unavailable("이용권 유효기간이 지나 환불을 요청할 수 없어요.");
  if (unusedCredits === 0) return unavailable("남은 이용권이 없어 환불을 요청할 수 없어요.");

  const expectedRefundKrw = Math.floor(priceKrw * (unusedCredits / safeAmount) * REFUND_POLICY.unusedCreditRefundRate);
  if (expectedRefundKrw <= 0) return unavailable("환불 예정 금액이 없어 요청할 수 없어요.");

  return {
    eligible: true,
    reason: null,
    usedCredits,
    unusedCredits,
    expectedRefundKrw,
    policySnapshot: {
      unusedCreditRefundRate: REFUND_POLICY.unusedCreditRefundRate,
      validityBasis: REFUND_POLICY.validityBasis,
      creditExpiresAt: expiresAt,
    },
  };
}

