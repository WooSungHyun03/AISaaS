"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { requireAdmin } from "@/server/admin/access";
import { recordAdminAudit } from "@/server/admin/audit";
import { answerInquiry } from "@/server/inquiries/inquiries";

export interface AdminInquiryActionState {
  error?: string;
  success?: boolean;
}

/** Answer and/or change the status of an inquiry. Admin only — the check runs here, on the server, every time. */
export async function answerInquiryAction(id: string, _prev: AdminInquiryActionState, formData: FormData): Promise<AdminInquiryActionState> {
  const { user, admin } = await requireAdmin({ action: "ADMIN_INQUIRY_UPDATE_ACCESS", targetType: "inquiry", targetId: id });
  if (!z.string().uuid().safeParse(id).success) return { error: "잘못된 요청이에요." };

  const status = String(formData.get("status") ?? "").trim();
  try {
    const result = await answerInquiry(admin, user.id, id, {
      reply: String(formData.get("reply") ?? ""),
      status: status || undefined,
    });
    if (!result.ok) return { error: result.error };
    await recordAdminAudit(admin, user, { action: "INQUIRY_UPDATED", targetType: "inquiry", targetId: id, metadata: { status: status || "AUTO", hasReply: Boolean(String(formData.get("reply") ?? "").trim()) } });
    revalidatePath("/admin/inquiries");
    revalidatePath(`/admin/inquiries/${id}`);
    revalidatePath("/support");
    return { success: true };
  } catch (error) {
    logger.error("inquiry_answer_failed", { inquiryId: id, message: error instanceof Error ? error.message : String(error) });
    return { error: "저장하지 못했어요. 잠시 후 다시 시도해주세요." };
  }
}
