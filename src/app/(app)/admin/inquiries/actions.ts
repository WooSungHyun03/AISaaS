"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { isAdminUser } from "@/server/admin/access";
import { answerInquiry } from "@/server/inquiries/inquiries";

export interface AdminInquiryActionState {
  error?: string;
  success?: boolean;
}

/** Answer and/or change the status of an inquiry. Admin only — the check runs here, on the server, every time. */
export async function answerInquiryAction(id: string, _prev: AdminInquiryActionState, formData: FormData): Promise<AdminInquiryActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isAdminUser(user)) return { error: "권한이 없어요." };
  if (!z.string().uuid().safeParse(id).success) return { error: "잘못된 요청이에요." };

  const status = String(formData.get("status") ?? "").trim();
  try {
    const result = await answerInquiry(createAdminClient(), user.id, id, {
      reply: String(formData.get("reply") ?? ""),
      status: status || undefined,
    });
    if (!result.ok) return { error: result.error };
    revalidatePath("/admin/inquiries");
    revalidatePath(`/admin/inquiries/${id}`);
    revalidatePath("/support");
    return { success: true };
  } catch (error) {
    logger.error("inquiry_answer_failed", { inquiryId: id, message: error instanceof Error ? error.message : String(error) });
    return { error: "저장하지 못했어요. 잠시 후 다시 시도해주세요." };
  }
}
