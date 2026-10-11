import { z } from "zod";
import type { CreditKind } from "@/server/billing/products";
import type { RefundRequestStatus } from "@/types/database.types";

export const REFUND_REQUEST_STATUSES = ["REQUESTED", "REVIEWING", "APPROVED", "REJECTED", "REFUNDED"] as const satisfies readonly RefundRequestStatus[];
export type { RefundRequestStatus } from "@/types/database.types";

export const REFUND_REQUEST_STATUS_LABEL: Record<RefundRequestStatus, string> = {
  REQUESTED: "요청 접수",
  REVIEWING: "검토 중",
  APPROVED: "승인",
  REJECTED: "반려",
  REFUNDED: "환불 완료",
};

export const REFUND_REASON = { min: 10, max: 2_000 } as const;

export const refundRequestInputSchema = z.object({
  orderId: z.string().uuid("주문을 다시 선택해주세요."),
  reason: z.string().trim()
    .min(REFUND_REASON.min, `환불 사유를 ${REFUND_REASON.min}자 이상 입력해주세요.`)
    .max(REFUND_REASON.max, `환불 사유는 ${REFUND_REASON.max.toLocaleString()}자 이하로 입력해주세요.`),
});

export interface RefundOrderOption {
  id: string;
  productName: string;
  kind: CreditKind;
  creditAmount: number;
  remainingCredits: number;
  priceKrw: number;
  paidAt: string;
  expiresAt: string | null;
  expectedRefundKrw: number;
  eligible: boolean;
  ineligibleReason: string | null;
}

export interface RefundRequestView {
  id: string;
  orderId: string;
  productName: string;
  status: RefundRequestStatus;
  reason: string;
  usedCredits: number;
  unusedCredits: number;
  expectedRefundKrw: number;
  createdAt: string;
  updatedAt: string;
}

