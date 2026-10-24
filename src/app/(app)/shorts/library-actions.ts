"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { VIDEO_BUCKET } from "@/server/shorts/assets";
import { getShortsContent, ownsVideoPath } from "@/server/shorts/library";
import { archiveExternalVideo } from "@/server/shorts/library-archive";
import type { Json } from "@/types/domain";

export interface LibraryActionResult {
  error?: string;
  success?: boolean;
  title?: string;
}

const NOT_FOUND = "영상을 찾을 수 없어요. 이미 삭제됐을 수 있어요.";
const titleSchema = z.string().trim().min(1, "제목을 입력해주세요.").max(100, "제목은 100자 이하로 입력해주세요.");

async function ownedContent(contentId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." as const };
  const content = await getShortsContent(supabase, contentId);
  return content ? { user, content } : { error: NOT_FOUND };
}

/** Renames a video in the library. Like every content_history change, it is written with the service role after RLS showed the row to the caller. */
export async function renameShortsContent(contentId: string, rawTitle: string): Promise<LibraryActionResult> {
  const parsed = titleSchema.safeParse(rawTitle);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "제목을 확인해주세요." };
  const owned = await ownedContent(contentId);
  if ("error" in owned) return { error: owned.error };

  const { data: updated, error } = await createAdminClient()
    .from("content_history")
    .update({ title: parsed.data, edited_at: new Date().toISOString() })
    .eq("id", owned.content.id)
    .eq("business_id", owned.content.businessId)
    .select("id")
    .maybeSingle();
  if (error || !updated) return { error: "저장하지 못했어요. 잠시 후 다시 시도해주세요." };
  revalidatePath("/shorts", "layout");
  return { success: true, title: parsed.data };
}

/**
 * Deletes one video: its files first, then its library entry. If the files cannot be removed the entry stays, so the
 * library never shows a video whose file is gone half-way and a retry finishes the job. The run row itself is kept
 * (credits, usage and the spend ledger refer to it); only its video address is taken out, so the studio no longer previews it.
 */
export async function deleteShortsContent(contentId: string): Promise<LibraryActionResult> {
  const owned = await ownedContent(contentId);
  if ("error" in owned) return { error: owned.error };
  const { content, user } = owned;
  const admin = createAdminClient();

  if (content.source.state === "STORED" && content.source.path) {
    if (!ownsVideoPath(content.source.path, user.id, content.automationId)) return { error: NOT_FOUND };
    // Everything the run stored next to the video (its voice track) goes with it.
    const folder = content.source.path.split("/").slice(0, -1).join("/");
    const { data: listed } = await admin.storage.from(VIDEO_BUCKET).list(folder, { limit: 100 });
    const paths = [...new Set([content.source.path, ...(listed ?? []).filter((file) => file.id).map((file) => `${folder}/${file.name}`)])];
    const { error: removeError } = await admin.storage.from(VIDEO_BUCKET).remove(paths);
    if (removeError) {
      logger.error("shorts_library_file_remove_failed", { contentId, message: removeError.message });
      return { error: "영상 파일을 지우지 못했어요. 잠시 후 다시 시도해주세요." };
    }
  }

  const { error: deleteError } = await admin.from("content_history").delete().eq("id", content.id).eq("business_id", content.businessId);
  if (deleteError) {
    logger.error("shorts_library_row_delete_failed", { contentId, message: deleteError.message });
    return { error: "삭제하지 못했어요. 잠시 후 다시 시도해주세요." };
  }

  if (content.runId && content.output && typeof content.output === "object" && !Array.isArray(content.output)) {
    const rest = Object.fromEntries(Object.entries(content.output as Record<string, Json | undefined>).filter(([key]) => key !== "videoPath" && key !== "videoUrl"));
    const { error: outputError } = await admin.from("automation_runs").update({ output: { ...rest, libraryDeleted: true } as Json }).eq("id", content.runId);
    if (outputError) logger.warn("shorts_library_run_output_update_failed", { contentId, message: outputError.message });
  }

  revalidatePath("/shorts", "layout");
  revalidatePath("/automations", "layout");
  return { success: true };
}

/** Moves an older, externally hosted video into the owner's own Storage, or says plainly that it can no longer be recovered. */
export async function archiveLegacyShortsVideo(contentId: string): Promise<LibraryActionResult> {
  const owned = await ownedContent(contentId);
  if ("error" in owned) return { error: owned.error };
  const { content, user } = owned;
  if (content.source.state === "STORED") return { success: true };
  if (content.source.state !== "EXTERNAL" || !content.source.externalUrl || !content.runId) return { error: "복구할 수 있는 영상 주소가 없어요." };

  const admin = createAdminClient();
  const archived = await archiveExternalVideo(admin, { url: content.source.externalUrl, userId: user.id, automationId: content.automationId, runId: content.runId });
  if (!archived.ok) {
    const reasons = {
      UNREACHABLE: "원본 영상이 이미 사라져서 복구할 수 없어요.",
      TOO_LARGE: "영상 파일이 너무 커서 옮기지 못했어요.",
      NOT_A_VIDEO: "원본이 영상 파일이 아니라서 옮기지 못했어요.",
      SAVE_FAILED: "보관함에 저장하지 못했어요. 잠시 후 다시 시도해주세요.",
    } as const;
    return { error: reasons[archived.reason] };
  }
  const { error } = await admin
    .from("content_history")
    .update({ video_path: archived.path, video_bytes: archived.bytes, video_checked_at: new Date().toISOString() })
    .eq("id", content.id)
    .eq("business_id", content.businessId);
  if (error) return { error: "보관함에 기록하지 못했어요. 잠시 후 다시 시도해주세요." };
  revalidatePath("/shorts", "layout");
  return { success: true };
}
