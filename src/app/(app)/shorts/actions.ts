"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runAutomationNow } from "@/server/automations/runner";
import { computeNextRunAt } from "@/server/automations/scheduler";
import { canCreateAutomation } from "@/server/billing/entitlements";
import type { AutomationSchedule, ShortsPublishPlatform } from "@/types/automation";
import type { Json } from "@/types/domain";

export interface ShortsActionResult {
  error?: string;
  success?: boolean;
  automationId?: string;
  runId?: string;
}

function parsePlatforms(values: string[]): ShortsPublishPlatform[] {
  return [...new Set(values.filter((value): value is ShortsPublishPlatform => value === "instagram" || value === "youtube"))];
}

async function ownedShortsAutomation(automationId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." } as const;
  const { data: automation, error } = await supabase
    .from("automations")
    .select("id,user_id,business_id,template_id,status,config")
    .eq("id", automationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !automation) return { error: "숏폼 만들기 설정을 찾을 수 없습니다." } as const;
  const { data: template } = await supabase.from("automation_templates").select("slug").eq("id", automation.template_id).maybeSingle();
  if (template?.slug !== "shorts") return { error: "숏폼 만들기 설정이 아닙니다." } as const;
  return { supabase, user, automation } as const;
}

export async function createShortsAutomation(businessId: string): Promise<ShortsActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };
  const [{ data: business }, { data: template }, entitlement] = await Promise.all([
    supabase.from("businesses").select("id,name").eq("id", businessId).eq("owner_id", user.id).maybeSingle(),
    supabase.from("automation_templates").select("id,is_active").eq("slug", "shorts").maybeSingle(),
    canCreateAutomation(supabase, user.id),
  ]);
  if (!business) return { error: "본인의 사업체를 선택해주세요." };
  if (!template?.is_active) return { error: "숏폼 만들기를 지금 시작할 수 없습니다." };
  if (!entitlement.allowed) return { error: entitlement.reason };

  const { data: existing } = await supabase.from("automations").select("id")
    .eq("user_id", user.id).eq("business_id", businessId).eq("template_id", template.id).limit(1).maybeSingle();
  if (existing) return { success: true, automationId: existing.id };

  const schedule: AutomationSchedule = { frequency: "WEEKLY", daysOfWeek: [1, 3, 5], timeOfDay: "18:00", timezone: "Asia/Seoul" };
  const { data: automation, error } = await supabase.from("automations").insert({
    user_id: user.id,
    business_id: businessId,
    template_id: template.id,
    name: `${business.name} 숏폼`,
    status: "DRAFT",
    schedule: schedule as unknown as Json,
    config: { platforms: ["instagram"] },
  }).select("id").single();
  if (error || !automation) return { error: "숏폼 만들기 설정을 만들지 못했습니다." };
  revalidatePath("/shorts");
  revalidatePath("/automations");
  return { success: true, automationId: automation.id };
}

export async function generateShortsPreview(automationId: string): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId);
  if ("error" in owned) return { error: owned.error };
  try {
    const result = await runAutomationNow(automationId, { shorts: { previewOnly: true } });
    if (result.status === "FAILED") return { error: result.errorMessage ?? "영상을 만들지 못했습니다.", runId: result.runId };
    revalidatePath("/shorts");
    revalidatePath("/automations/history");
    return { success: true, runId: result.runId };
  } catch (error) {
    const message = error instanceof Error && error.message.includes("already has a run")
      ? "이미 영상을 만들고 있습니다. 완료 후 다시 시도해주세요."
      : "영상을 만들지 못했습니다. 잠시 후 다시 시도해주세요.";
    return { error: message };
  }
}

export async function publishShortsNow(
  automationId: string,
  sourceRunId: string,
  selectedPlatforms: string[],
): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId);
  if ("error" in owned) return { error: owned.error };
  const platforms = parsePlatforms(selectedPlatforms);
  if (platforms.length === 0) return { error: "게시할 플랫폼을 한 개 이상 선택해주세요." };
  const { data: sourceRun } = await owned.supabase.from("automation_runs").select("id,status")
    .eq("id", sourceRunId).eq("automation_id", automationId).maybeSingle();
  if (!sourceRun || sourceRun.status !== "SUCCESS") return { error: "게시할 미리보기 영상을 찾을 수 없습니다." };

  try {
    const result = await runAutomationNow(automationId, { shorts: { publish: { sourceRunId, platforms } } });
    if (result.status === "FAILED") return { error: result.errorMessage ?? "영상을 게시하지 못했습니다.", runId: result.runId };
    revalidatePath("/shorts");
    revalidatePath("/automations/history");
    return { success: true, runId: result.runId };
  } catch (error) {
    const message = error instanceof Error && error.message.includes("already has a run")
      ? "이미 게시 작업이 진행 중입니다. 완료 후 다시 시도해주세요."
      : "영상을 게시하지 못했습니다. 연결 상태를 확인해주세요.";
    return { error: message };
  }
}

export async function saveShortsSchedule(automationId: string, formData: FormData): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId);
  if ("error" in owned) return { error: owned.error };
  const frequency = String(formData.get("frequency") ?? "");
  const timeOfDay = String(formData.get("timeOfDay") ?? "");
  const daysOfWeek = formData.getAll("daysOfWeek").map(Number);
  const platforms = parsePlatforms(formData.getAll("platforms").map(String));
  if ((frequency !== "DAILY" && frequency !== "WEEKLY") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) {
    return { error: "게시 주기와 시간을 확인해주세요." };
  }
  if (frequency === "WEEKLY" && (daysOfWeek.length === 0 || daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6))) {
    return { error: "매주 게시할 요일을 한 개 이상 선택해주세요." };
  }
  if (platforms.length === 0) return { error: "자동 게시할 플랫폼을 한 개 이상 선택해주세요." };

  const { data: inFlight } = await owned.supabase.from("automation_runs").select("id")
    .eq("automation_id", automationId).in("status", ["QUEUED", "RUNNING"]).limit(1).maybeSingle();
  if (inFlight) return { error: "실행 중에는 예약 설정을 바꿀 수 없습니다." };
  const { data: connections } = await owned.supabase.from("integration_connections").select("provider,status")
    .eq("user_id", owned.user.id).eq("business_id", owned.automation.business_id).in("provider", platforms);
  const connected = new Set((connections ?? []).filter((item) => item.status === "CONNECTED").map((item) => item.provider));
  const missing = platforms.filter((platform) => !connected.has(platform));
  if (missing.length > 0) return { error: `${missing.map((item) => item === "youtube" ? "YouTube" : "Instagram").join(", ")} 연결을 먼저 완료해주세요.` };

  const schedule: AutomationSchedule = {
    frequency,
    timeOfDay,
    timezone: "Asia/Seoul",
    ...(frequency === "WEEKLY" ? { daysOfWeek: [...new Set(daysOfWeek)] } : {}),
  };
  const currentConfig = owned.automation.config && typeof owned.automation.config === "object" && !Array.isArray(owned.automation.config)
    ? owned.automation.config as Record<string, Json | undefined>
    : {};
  const { error } = await owned.supabase.from("automations").update({
    schedule: schedule as unknown as Json,
    config: { ...currentConfig, platforms },
    status: "ACTIVE",
    next_run_at: computeNextRunAt(schedule).toISOString(),
  }).eq("id", automationId).eq("user_id", owned.user.id);
  if (error) return { error: "예약 설정을 저장하지 못했습니다." };
  revalidatePath("/shorts");
  revalidatePath(`/automations/${automationId}`);
  revalidatePath("/dashboard");
  return { success: true };
}

