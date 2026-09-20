"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canCreateAutomation, canExecuteAutomation } from "@/server/billing/entitlements";
import { runAutomationNow } from "@/server/automations/runner";
import { computeNextRunAt } from "@/server/automations/scheduler";
import type { AutomationSchedule } from "@/types/automation";
import type { Json } from "@/types/domain";

export interface AutomationActionState {
  error?: string;
}

function scheduleFromForm(formData: FormData): AutomationSchedule {
  const frequency = String(formData.get("frequency") ?? "WEEKLY") as AutomationSchedule["frequency"];
  const timeOfDay = String(formData.get("timeOfDay") ?? "09:00");
  const daysOfWeek = formData.getAll("daysOfWeek").map((value) => Number(value));

  return {
    frequency,
    timeOfDay,
    ...(frequency === "WEEKLY" ? { daysOfWeek: daysOfWeek.length ? daysOfWeek : [1, 3, 5] } : {}),
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

  const entitlement = await canCreateAutomation(supabase, user.id);
  if (!entitlement.allowed) {
    return { error: entitlement.reason };
  }

  const { data: automation, error } = await supabase
    .from("automations")
    .insert({
      user_id: user.id,
      business_id: businessId,
      template_id: templateId,
      name,
      status: "DRAFT",
      schedule: scheduleFromForm(formData) as unknown as Json,
      config: {},
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
  const { data: automation } = await supabase.from("automations").select("schedule").eq("id", automationId).single();
  if (!automation) return;

  const nextRunAt = computeNextRunAt(automation.schedule as unknown as AutomationSchedule);

  await supabase
    .from("automations")
    .update({ status: "ACTIVE", next_run_at: nextRunAt.toISOString() })
    .eq("id", automationId);

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

  const result = await runAutomationNow(automationId);
  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/dashboard");

  if (result.status === "FAILED") {
    return { error: result.errorMessage ?? "실행 중 오류가 발생했습니다." };
  }
  return { success: true };
}
