"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeShortsPublishing, type ShortsPublishing } from "@/server/shorts/publishing-metadata";
import type { Json } from "@/types/domain";

export interface UpdateShortsPublishingResult {
  error?: string;
  success?: boolean;
  value?: ShortsPublishing;
  editedAt?: string;
}

/**
 * Saves the owner's edit of a Short's posting text (title, description, keywords, hashtags …).
 *
 * Like the blog edit, content_history has no UPDATE policy for customers, so the write uses the service role after
 * confirming under RLS that the caller can see the row, and touches only the `publishing` and `edited_at` columns.
 * What is saved here is what "지금 게시" and a scheduled post send to YouTube / Instagram.
 */
export async function updateShortsPublishing(contentId: string, input: unknown): Promise<UpdateShortsPublishingResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };
  if (!z.string().uuid().safeParse(contentId).success) return { error: "수정할 영상 정보를 찾을 수 없어요." };

  const normalized = normalizeShortsPublishing(input);
  if (!normalized.ok) return { error: normalized.error };

  const { data: existing, error: readError } = await supabase
    .from("content_history")
    .select("id,business_id,content_type")
    .eq("id", contentId)
    .maybeSingle();
  if (readError || !existing || existing.content_type !== "shorts") return { error: "수정할 영상 정보를 찾을 수 없어요." };

  const editedAt = new Date().toISOString();
  const { data: updated, error } = await createAdminClient()
    .from("content_history")
    .update({ publishing: normalized.value as unknown as Json, edited_at: editedAt })
    .eq("id", existing.id)
    .eq("business_id", existing.business_id)
    .select("id")
    .maybeSingle();
  if (error || !updated) return { error: "저장하지 못했어요. 잠시 후 다시 시도해주세요." };

  revalidatePath("/shorts");
  revalidatePath("/automations", "layout");
  return { success: true, value: normalized.value, editedAt };
}
