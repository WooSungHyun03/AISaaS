"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/admin/access";
import { recordAdminAudit } from "@/server/admin/audit";
import { executeRefund, reviewRefund } from "@/server/admin/operations";
import type { AdminActionState } from "@/app/(admin)/admin/users/[id]/actions";

export async function reviewRefundAction(requestId: string, _previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const { user, admin } = await requireAdmin({ action: "ADMIN_REFUND_REVIEW_ATTEMPT", targetType: "refund_request", targetId: requestId });
  const rawDecision = String(formData.get("decision") ?? "");
  if (!["REVIEWING", "APPROVED", "REJECTED"].includes(rawDecision)) return { ok: false, message: "처리 상태가 올바르지 않습니다." };
  const decision = rawDecision as "REVIEWING" | "APPROVED" | "REJECTED";
  const note = String(formData.get("note") ?? "").trim();
  try {
    await reviewRefund(admin, { requestId, adminId: user.id, decision, note });
    await recordAdminAudit(admin, user, { action: `REFUND_${decision}`, targetType: "refund_request", targetId: requestId, metadata: { decision } });
    revalidatePath("/admin/refunds");
    revalidatePath(`/admin/refunds/${requestId}`);
    return { ok: true, message: "환불 요청 상태를 변경했습니다." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "환불 요청을 처리하지 못했습니다." };
  }
}

export async function executeRefundAction(requestId: string, _previous: AdminActionState, _formData: FormData): Promise<AdminActionState> {
  const { user, admin } = await requireAdmin({ action: "ADMIN_REFUND_EXECUTE_ATTEMPT", targetType: "refund_request", targetId: requestId });
  try {
    const result = await executeRefund(admin, requestId);
    await recordAdminAudit(admin, user, { action: result.alreadyCompleted ? "REFUND_EXECUTE_IDEMPOTENT" : "REFUND_EXECUTED", targetType: "refund_request", targetId: requestId, metadata: { refundedAmount: result.refundedAmount } });
    revalidatePath("/admin/refunds");
    revalidatePath(`/admin/refunds/${requestId}`);
    revalidatePath("/admin/payments");
    return { ok: true, message: result.alreadyCompleted ? "이미 완료된 환불입니다." : "테스트 결제를 취소하고 크레딧을 회수했습니다." };
  } catch (error) {
    await recordAdminAudit(admin, user, { action: "REFUND_EXECUTION_FAILED", targetType: "refund_request", targetId: requestId, metadata: { retryable: true } });
    revalidatePath(`/admin/refunds/${requestId}`);
    return { ok: false, message: `${error instanceof Error ? error.message : "환불 실행에 실패했습니다."} 같은 요청으로 다시 시도할 수 있습니다.` };
  }
}
