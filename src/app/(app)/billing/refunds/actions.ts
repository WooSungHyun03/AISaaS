"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { submitRefundRequest } from "@/server/billing/refund-requests";

export interface RefundRequestActionState {
  error?: string;
  success?: boolean;
  requestId?: string;
}

export async function submitRefundRequestAction(
  _previous: RefundRequestActionState,
  formData: FormData,
): Promise<RefundRequestActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  try {
    const result = await submitRefundRequest(user.id, {
      orderId: String(formData.get("orderId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { error: result.error };
    revalidatePath("/billing/refunds");
    revalidatePath("/billing");
    return { success: true, requestId: result.requestId };
  } catch (error) {
    logger.error("refund_request_submit_failed", {
      userId: user.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { error: "환불 요청을 저장하지 못했어요. 잠시 후 다시 시도해주세요." };
  }
}

