"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeAutomationRunError } from "@/server/shared/errors";
import { runAutomationNow } from "@/server/automations/runner";
import { computeNextRunAt } from "@/server/automations/scheduler";
import { parseScheduleFromForm } from "@/server/automations/schedule-input";
import { canCreateAutomation } from "@/server/billing/entitlements";
import {
  deleteReferenceImage,
  detectImageType,
  isOwnedReferencePath,
  referenceStoragePath,
  uploadReferenceImage,
} from "@/server/shorts/reference-images";
import type { AutomationSchedule, ShortsPublishPlatform } from "@/types/automation";
import {
  MASCOT_POSES,
  MAX_REFERENCE_UPLOAD_BYTES,
  MAX_SHORTS_REFERENCES,
  REFERENCE_LABEL_MAX_LENGTH,
  SHORTS_BRIEF_MAX_LENGTH,
  SHORTS_STYLES,
  parseShortsReferenceSettings,
  type ShortsReference,
  type ShortsStyle,
} from "@/types/shorts-reference";
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
    // Posting is always an explicit opt-in (saveShortsSchedule): a fresh
    // automation only ever produces previews.
    config: { platforms: [] },
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
    if (result.status === "FAILED") return { error: describeAutomationRunError(result.errorMessage), runId: result.runId };
    revalidatePath("/shorts");
    revalidatePath("/automations/history");
    revalidatePath("/usage");
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
    if (result.status === "FAILED") return { error: describeAutomationRunError(result.errorMessage), runId: result.runId };
    revalidatePath("/shorts");
    revalidatePath("/automations/history");
    revalidatePath("/usage");
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
  const schedule = parseScheduleFromForm(formData, "Asia/Seoul");
  if (!schedule) return { error: "주기, 요일(날짜), 시간을 확인해주세요." };
  const platforms = parsePlatforms(formData.getAll("platforms").map(String));

  const { data: inFlight } = await owned.supabase.from("automation_runs").select("id")
    .eq("automation_id", automationId).in("status", ["QUEUED", "RUNNING"]).limit(1).maybeSingle();
  if (inFlight) return { error: "실행 중에는 예약 설정을 바꿀 수 없습니다." };
  if (platforms.length > 0) {
    const { data: connections } = await owned.supabase.from("integration_connections").select("provider,status")
      .eq("user_id", owned.user.id).eq("business_id", owned.automation.business_id).in("provider", platforms);
    const connected = new Set((connections ?? []).filter((item) => item.status === "CONNECTED").map((item) => item.provider));
    const missing = platforms.filter((platform) => !connected.has(platform));
    if (missing.length > 0) return { error: `${missing.map((item) => item === "youtube" ? "YouTube" : "Instagram").join(", ")} 연결을 먼저 완료해주세요.` };
  }

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


type OwnedShorts = Exclude<Awaited<ReturnType<typeof ownedShortsAutomation>>, { error: string }>;

const DEFAULT_MASCOT_BRIEF = "이지 마케팅 서비스(마케팅 진단, 콘텐츠 캘린더, 블로그 글, 숏폼 영상을 AI가 만들어 줘요)를 사장님께 소개하는 웃긴 캐릭터 콩트";

/** Writes the reference list / creative settings into `automations.config`, keeping every other key (platforms …). */
async function writeShortsConfig(
  owned: OwnedShorts,
  patch: { references?: ShortsReference[]; shortsStyle?: ShortsStyle; shortsBrief?: string },
): Promise<string | null> {
  const current = owned.automation.config && typeof owned.automation.config === "object" && !Array.isArray(owned.automation.config)
    ? owned.automation.config as Record<string, Json | undefined>
    : {};
  const { error } = await owned.supabase.from("automations").update({
    config: { ...current, ...patch } as unknown as Json,
  }).eq("id", owned.automation.id).eq("user_id", owned.user.id);
  if (error) return "설정을 저장하지 못했어요. 잠시 후 다시 시도해주세요.";
  revalidatePath("/shorts");
  return null;
}

export async function uploadShortsReference(automationId: string, formData: FormData): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId);
  if ("error" in owned) return { error: owned.error };
  const settings = parseShortsReferenceSettings(owned.automation.config);
  if (settings.references.length >= MAX_SHORTS_REFERENCES) return { error: `참고 이미지는 최대 ${MAX_SHORTS_REFERENCES}장까지 쓸 수 있어요.` };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "이미지 파일을 선택해주세요." };
  if (file.size > MAX_REFERENCE_UPLOAD_BYTES) return { error: "이미지가 너무 커요. 3MB 이하로 줄여서 올려주세요." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) return { error: "PNG 또는 JPG 이미지만 올릴 수 있어요." };
  const label = String(formData.get("label") ?? "").trim().slice(0, REFERENCE_LABEL_MAX_LENGTH);

  const id = crypto.randomUUID();
  const path = referenceStoragePath(owned.user.id, automationId, id, type);
  const admin = createAdminClient();
  try {
    await uploadReferenceImage(admin, path, bytes, type);
  } catch {
    return { error: "이미지를 저장하지 못했어요. 잠시 후 다시 시도해주세요." };
  }
  const failure = await writeShortsConfig(owned, { references: [...settings.references, { id, kind: "upload", source: path, label }] });
  if (failure) {
    await deleteReferenceImage(admin, path);
    return { error: failure };
  }
  return { success: true };
}

export async function addMascotReferences(automationId: string): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId);
  if ("error" in owned) return { error: owned.error };
  const settings = parseShortsReferenceSettings(owned.automation.config);
  const have = new Set(settings.references.filter((item) => item.kind === "mascot").map((item) => item.source));
  const room = MAX_SHORTS_REFERENCES - settings.references.length;
  const additions: ShortsReference[] = MASCOT_POSES.filter((pose) => !have.has(pose.key)).slice(0, Math.max(0, room)).map((pose) => ({
    id: `mascot-${pose.key}`,
    kind: "mascot",
    source: pose.key,
    label: pose.label,
  }));
  if (additions.length === 0) {
    return { error: room <= 0 ? "참고 이미지가 가득 찼어요. 일부를 지운 뒤 마스코트를 불러오세요." : "마스코트 이미지를 이미 모두 불러왔어요." };
  }
  const failure = await writeShortsConfig(owned, {
    references: [...settings.references, ...additions],
    ...(settings.brief ? {} : { shortsBrief: DEFAULT_MASCOT_BRIEF }),
  });
  return failure ? { error: failure } : { success: true };
}

export async function removeShortsReference(automationId: string, referenceId: string): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId);
  if ("error" in owned) return { error: owned.error };
  const settings = parseShortsReferenceSettings(owned.automation.config);
  const target = settings.references.find((item) => item.id === referenceId);
  if (!target) return { success: true };
  const failure = await writeShortsConfig(owned, { references: settings.references.filter((item) => item.id !== referenceId) });
  if (failure) return { error: failure };
  if (target.kind === "upload" && isOwnedReferencePath(target.source, owned.user.id, automationId)) {
    await deleteReferenceImage(createAdminClient(), target.source);
  }
  return { success: true };
}

export async function saveShortsCreativeSettings(
  automationId: string,
  input: { style: string; brief: string },
): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId);
  if ("error" in owned) return { error: owned.error };
  if (!(input.style in SHORTS_STYLES)) return { error: "영상 스타일을 확인해주세요." };
  const brief = input.brief.trim();
  if (brief.length > SHORTS_BRIEF_MAX_LENGTH) return { error: `요청 사항은 ${SHORTS_BRIEF_MAX_LENGTH}자 이내로 적어주세요.` };
  const failure = await writeShortsConfig(owned, { shortsStyle: input.style as ShortsStyle, shortsBrief: brief });
  return failure ? { error: failure } : { success: true };
}
