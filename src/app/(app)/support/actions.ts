"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { closeOwnInquiry, submitInquiry } from "@/server/inquiries/inquiries";

export interface InquiryActionState {
  error?: string;
  success?: boolean;
}

export async function submitInquiryAction(_prev: InquiryActionState, formData: FormData): Promise<InquiryActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };
  try {
    const result = await submitInquiry(supabase, user.id, {
      category: String(formData.get("category") ?? ""),
      subject: String(formData.get("subject") ?? ""),
      body: String(formData.get("body") ?? ""),
    });
    if (!result.ok) return { error: result.error };
    revalidatePath("/support");
    return { success: true };
  } catch (error) {
    logger.error("inquiry_submit_failed", { message: error instanceof Error ? error.message : String(error) });
    return { error: "문의를 보내지 못했어요. 잠시 후 다시 시도해주세요." };
  }
}

export async function closeInquiryAction(id: string): Promise<InquiryActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };
  if (!z.string().uuid().safeParse(id).success) return { error: "잘못된 요청이에요." };
  try {
    const result = await closeOwnInquiry(createAdminClient(), user.id, id);
    if (!result.ok) return { error: result.error };
    revalidatePath("/support");
    return { success: true };
  } catch (error) {
    logger.error("inquiry_close_failed", { message: error instanceof Error ? error.message : String(error) });
    return { error: "문의를 종료하지 못했어요. 잠시 후 다시 시도해주세요." };
  }
}
