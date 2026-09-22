"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canCreateAutomation, canExecuteAutomation } from "@/server/billing/entitlements";
import { runAutomationNow } from "@/server/automations/runner";
import { computeNextRunAt } from "@/server/automations/scheduler";
import { WordPressConnector, normalizeWordPressSiteUrl } from "@/server/connectors/wordpress";
import { encryptWordPressPassword } from "@/server/connectors/wordpress/credentials";
import { AUTOMATION_AVAILABILITY, type AutomationSchedule } from "@/types/automation";
import { blogSetupSchema, type BlogAutomationConfig } from "@/types/blog-automation";
import type { Json } from "@/types/domain";

export interface AutomationActionState {
  error?: string;
}

function scheduleFromForm(formData: FormData): AutomationSchedule | null {
  const frequency = String(formData.get("frequency") ?? "");
  const timeOfDay = String(formData.get("timeOfDay") ?? "09:00");
  const daysOfWeek = formData.getAll("daysOfWeek").map((value) => Number(value));
  if ((frequency !== "DAILY" && frequency !== "WEEKLY") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) return null;
  if (frequency === "WEEKLY" && (daysOfWeek.length === 0 || daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) return null;

  return {
    frequency,
    timeOfDay,
    ...(frequency === "WEEKLY" ? { daysOfWeek: [...new Set(daysOfWeek)] } : {}),
  };
}

export async function createAutomation(
  _prevState: AutomationActionState,
  formData: FormData,
): Promise<AutomationActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const businessId = String(formData.get("businessId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!businessId || !templateId || !name) {
    return { error: "모든 필수 항목을 입력해주세요." };
  }

  const [businessResult, templateResult] = await Promise.all([
    supabase.from("businesses").select("id").eq("id", businessId).eq("owner_id", user.id).maybeSingle(),
    supabase.from("automation_templates").select("slug, is_active").eq("id", templateId).maybeSingle(),
  ]);
  if (businessResult.error || templateResult.error) {
    return { error: "사업체와 자동화 유형을 확인하는 중 오류가 발생했습니다." };
  }
  if (!businessResult.data) return { error: "본인의 사업체를 선택해주세요." };
  const template = templateResult.data;
  const availability = template ? AUTOMATION_AVAILABILITY[template.slug as keyof typeof AUTOMATION_AVAILABILITY] : undefined;
  if (!template?.is_active || (availability !== "AVAILABLE" && availability !== "BETA")) {
    return { error: "아직 생성할 수 없는 자동화입니다." };
  }

  const entitlement = await canCreateAutomation(supabase, user.id);
  if (!entitlement.allowed) {
    return { error: entitlement.reason };
  }

  const schedule = scheduleFromForm(formData);
  if (!schedule) return { error: "실행 주기, 요일, 시간을 확인해주세요." };

  let config: Json = {};
  if (template.slug === "blog-marketing") {
    const parsed = blogSetupSchema.safeParse({
      objective: String(formData.get("objective") ?? ""),
      keywords: String(formData.get("keywords") ?? "").split(/[,\n]/).map((keyword) => keyword.trim()).filter(Boolean),
      tone: String(formData.get("tone") ?? ""),
      deliveryMode: String(formData.get("deliveryMode") ?? ""),
    });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "블로그 설정을 확인해주세요." };

    const blogConfig: BlogAutomationConfig = parsed.data;
    if (parsed.data.deliveryMode !== "app_draft") {
      const siteUrlInput = String(formData.get("wordpressSiteUrl") ?? "");
      const username = String(formData.get("wordpressUsername") ?? "").trim();
      const appPassword = String(formData.get("wordpressAppPassword") ?? "").trim();
      if (!siteUrlInput || !username || !appPassword) return { error: "WordPress 사이트 주소, 사용자명, Application Password를 모두 입력해주세요." };

      try {
        const siteUrl = normalizeWordPressSiteUrl(siteUrlInput);
        await new WordPressConnector({ siteUrl, username, appPassword }).testConnection();
        blogConfig.wordpress = { siteUrl, username, encryptedAppPassword: encryptWordPressPassword(appPassword) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : "WordPress 연결을 확인할 수 없습니다." };
      }
    }
    config = blogConfig as unknown as Json;
  }

  const { data: automation, error } = await supabase
    .from("automations")
    .insert({
      user_id: user.id,
      business_id: businessId,
      template_id: templateId,
      name,
      status: "DRAFT",
      schedule: schedule as unknown as Json,
      config,
    })
    .select()
    .single();

  if (error || !automation) {
    return { error: "자동화 생성 중 오류가 발생했습니다." };
  }

  revalidatePath("/automations");
  redirect(`/automations/${automation.id}`);
}

export async function activateAutomation(automationId: string): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인이 필요합니다.");
  const { data: automation } = await supabase.from("automations").select("schedule").eq("id", automationId).eq("user_id", user.id).single();
  if (!automation) throw new Error("자동화를 찾을 수 없습니다.");

  const nextRunAt = computeNextRunAt(automation.schedule as unknown as AutomationSchedule);

  const { error } = await supabase
    .from("automations")
    .update({ status: "ACTIVE", next_run_at: nextRunAt.toISOString() })
    .eq("id", automationId).eq("user_id", user.id);
  if (error) throw new Error("자동화를 활성화하지 못했습니다.");

  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/automations");
}

export async function pauseAutomation(automationId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("automations").update({ status: "PAUSED", next_run_at: null }).eq("id", automationId);
  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/automations");
}

export async function deleteAutomation(automationId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("automations").delete().eq("id", automationId);
  revalidatePath("/automations");
  redirect("/automations");
}

export interface RunNowState {
  error?: string;
  success?: boolean;
}

export async function triggerRunNow(automationId: string): Promise<RunNowState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data: automation } = await supabase
    .from("automations")
    .select("id, user_id, template_id")
    .eq("id", automationId)
    .single();
  if (!automation || automation.user_id !== user.id) {
    return { error: "자동화를 찾을 수 없습니다." };
  }

  const { data: template } = await supabase
    .from("automation_templates")
    .select("slug")
    .eq("id", automation.template_id)
    .single();
  if (!template) return { error: "자동화 템플릿을 찾을 수 없습니다." };

  const entitlement = await canExecuteAutomation(supabase, user.id, template.slug);
  if (!entitlement.allowed) {
    return { error: entitlement.reason };
  }

  let result;
  try {
    result = await runAutomationNow(automationId);
  } catch (error) {
    if (error instanceof Error && (error.message.includes("already has a run") || error.message.includes("automation_runs_one_active_run"))) {
      return { error: "이미 실행 중입니다. 완료 후 다시 시도해주세요." };
    }
    return { error: "실행을 시작하지 못했습니다. 잠시 후 다시 시도해주세요." };
  }
  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/dashboard");

  if (result.status === "FAILED") {
    return { error: result.errorMessage ?? "실행 중 오류가 발생했습니다." };
  }
  return { success: true };
}
