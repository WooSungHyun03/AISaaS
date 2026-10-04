"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface UpdateContentState {
  error?: string;
  success?: boolean;
  editedAt?: string;
}

const editSchema = z.object({
  contentId: z.string().uuid(),
  title: z.string().trim().min(1, "제목을 입력해주세요.").max(200, "제목은 200자 이하로 입력해주세요."),
  content: z.string().trim().min(1, "본문을 입력해주세요.").max(30_000, "본문은 30,000자 이하로 입력해주세요."),
});

/**
 * Saves the user's edited copy of a generated post.
 *
 * content_history has no UPDATE policy on purpose (a client could otherwise
 * rewrite run_id/external_url too), so the write goes through the service
 * role — after confirming under RLS that the caller can actually see the row
 * (the select policy only returns rows of businesses they own), and limited
 * to exactly the title/content columns.
 */
export async function updateContentHistory(contentId: string, formData: FormData): Promise<UpdateContentState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const parsed = editSchema.safeParse({ contentId, title: formData.get("title"), content: formData.get("content") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력 내용을 확인해주세요." };

  const { data: existing, error: readError } = await supabase
    .from("content_history")
    .select("id,business_id")
    .eq("id", parsed.data.contentId)
    .maybeSingle();
  if (readError || !existing) return { error: "수정할 글을 찾을 수 없어요." };

  const editedAt = new Date().toISOString();
  const { data: updated, error } = await createAdminClient()
    .from("content_history")
    .update({ title: parsed.data.title, content: parsed.data.content, edited_at: editedAt })
    .eq("id", existing.id)
    .eq("business_id", existing.business_id)
    .select("id")
    .maybeSingle();
  if (error || !updated) return { error: "저장하지 못했어요. 잠시 후 다시 시도해주세요." };

  revalidatePath("/blog");
  revalidatePath("/automations", "layout");
  return { success: true, editedAt };
}
