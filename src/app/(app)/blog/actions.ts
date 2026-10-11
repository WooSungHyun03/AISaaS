"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { canCreateAutomation } from "@/server/billing/entitlements";
import { blogPlatforms, type BlogAutomationConfig } from "@/types/blog-automation";
import type { AutomationSchedule } from "@/types/automation";
import type { Json } from "@/types/domain";

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


export interface CreateBlogAutomationState {
  error?: string;
  automationId?: string;
}

const DEFAULT_OBJECTIVE = {
  STORE: "신규 고객의 방문·예약·문의 늘리기",
  PRODUCT: "상품 관심을 구매로 이어지게 하기",
  PLATFORM: "서비스 이해를 높이고 가입 늘리기",
} as const;

/**
 * "바로 만들기": sets up the owner's blog writing from what the business profile already says (goal by type,
 * keywords, tone) so the first post needs one click — details can still be edited in the settings afterwards.
 * It only saves a draft setup; writing a post is a separate, credit-metered run.
 */
export async function createBlogAutomation(businessId: string, platform: string): Promise<CreateBlogAutomationState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };
  if (!(blogPlatforms as readonly string[]).includes(platform)) return { error: "글을 올릴 곳(네이버·티스토리)을 골라주세요." };

  const [{ data: business }, { data: template }, entitlement] = await Promise.all([
    supabase.from("businesses").select("*").eq("id", businessId).eq("owner_id", user.id).maybeSingle(),
    supabase.from("automation_templates").select("id,is_active").eq("slug", "blog-marketing").maybeSingle(),
    canCreateAutomation(supabase, user.id),
  ]);
  if (!business) return { error: "본인의 사업체를 선택해주세요." };
  if (!business.promotion_type) return { error: "홍보 대상(가게·상품·플랫폼)을 먼저 골라주세요." };
  if (!template?.is_active) return { error: "블로그 글 만들기를 지금 시작할 수 없습니다." };
  if (!entitlement.allowed) return { error: entitlement.reason };

  const { data: existing } = await supabase.from("automations").select("id")
    .eq("user_id", user.id).eq("business_id", businessId).eq("template_id", template.id).limit(1).maybeSingle();
  if (existing) return { automationId: existing.id };

  const config: BlogAutomationConfig = {
    objective: DEFAULT_OBJECTIVE[business.promotion_type],
    keywords: (business.keywords.length > 0 ? business.keywords : [business.name]).slice(0, 12),
    tone: business.brand_tone?.trim() || "친근하고 전문적인",
    deliveryMode: "app_draft",
    platform: platform as BlogAutomationConfig["platform"],
  };
  const schedule: AutomationSchedule = { frequency: "WEEKLY", daysOfWeek: [1, 3, 5], timeOfDay: "09:00", timezone: "Asia/Seoul" };
  const { data: automation, error } = await supabase.from("automations").insert({
    user_id: user.id,
    business_id: businessId,
    template_id: template.id,
    name: `${business.name} 블로그`,
    status: "DRAFT",
    schedule: schedule as unknown as Json,
    config: config as unknown as Json,
  }).select("id").single();
  if (error || !automation) return { error: "블로그 만들기 설정을 만들지 못했습니다." };

  revalidatePath("/blog");
  revalidatePath("/automations");
  return { automationId: automation.id };
}
