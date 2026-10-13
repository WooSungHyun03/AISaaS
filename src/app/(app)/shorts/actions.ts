"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeAutomationRunError } from "@/server/shared/errors";
import { advanceDeferredRun, runAutomationNow } from "@/server/automations/runner";
import { computeNextRunAt } from "@/server/automations/scheduler";
import { parseScheduleFromForm } from "@/server/automations/schedule-input";
import { canCreateAutomation } from "@/server/billing/entitlements";
import { getPostprocessProvider } from "@/server/connectors/postprocess";
import {
  assetStoragePath,
  checkAssetBasics,
  checkAssetLimits,
  createAssetUpload,
  detectAssetType,
  isOwnedAssetPath,
  readAssetHead,
  removeAssets,
  signAsset,
  REFERENCE_BUCKET,
} from "@/server/shorts/assets";
import type { AutomationSchedule, ShortsPublishPlatform } from "@/types/automation";
import {
  ASSET_LABEL_MAX_LENGTH,
  ASSET_LIMITS,
  ASSET_ROLES,
  MASCOT_POSES,
  SHORTS_BRIEF_MAX_LENGTH,
  SHORTS_DURATION,
  parseShortsSettings,
  type ShortsAsset,
  type ShortsAssetKind,
  type ShortsAssetRole,
  type VoiceMode,
} from "@/types/shorts-reference";
import type { Json } from "@/types/domain";

export interface ShortsActionResult {
  error?: string;
  success?: boolean;
  automationId?: string;
  runId?: string;
  /** True when the video is still being made in the background (animated Shorts take minutes). */
  pending?: boolean;
  progress?: string;
}

/** A video is built from the owner's photos or clips (a product, a shop, a person …); without one there is nothing to build from. */
const NEEDS_ASSETS = "사진이나 참고 영상을 먼저 추가해주세요. 상품·매장 사진을 올리거나 이지 마케팅 마스코트를 불러오면 광고 영상을 만들 수 있어요.";

function hasVisualAssets(config: unknown): boolean {
  return parseShortsSettings(config).assets.some((asset) => asset.kind === "image" || asset.kind === "video");
}

function parsePlatforms(values: string[]): ShortsPublishPlatform[] {
  return [...new Set(values.filter((value): value is ShortsPublishPlatform => value === "instagram" || value === "youtube"))];
}

/** Template slugs that can hold uploaded reference files. Blog posts only take photos. */
const REFERENCE_TEMPLATES = ["shorts", "blog-marketing"] as const;

async function ownedShortsAutomation(automationId: string, allowed: readonly string[] = ["shorts"]) {
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
  if (!template || !allowed.includes(template.slug)) return { error: "숏폼 만들기 설정이 아닙니다." } as const;
  return { supabase, user, automation, slug: template.slug } as const;
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
  if (!hasVisualAssets(owned.automation.config)) return { error: NEEDS_ASSETS };
  try {
    const result = await runAutomationNow(automationId, { shorts: { previewOnly: true } });
    if (result.status === "FAILED") return { error: describeAutomationRunError(result.errorMessage), runId: result.runId };
    revalidatePath("/shorts");
    revalidatePath("/automations/history");
    revalidatePath("/usage");
    return { success: true, runId: result.runId, pending: result.status === "RUNNING", progress: result.progress };
  } catch (error) {
    const message = error instanceof Error && error.message.includes("already has a run")
      ? "이미 영상을 만들고 있습니다. 완료 후 다시 시도해주세요."
      : "영상을 만들지 못했습니다. 잠시 후 다시 시도해주세요.";
    return { error: message };
  }
}

/**
 * Moves an in-flight (deferred) video forward by one quick step. The Shorts page calls this every
 * few seconds while it is open; the cron tick does the same when nobody is looking, and a lease
 * inside advanceDeferredRun keeps the two from stepping on each other.
 */
export async function advanceShortsJob(automationId: string): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId);
  if ("error" in owned) return { error: owned.error };
  const { data: run } = await owned.supabase.from("automation_runs").select("id")
    .eq("automation_id", automationId).eq("status", "RUNNING").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!run) return { success: true, pending: false };
  try {
    const step = await advanceDeferredRun(run.id);
    if (step.status === "SUCCESS" || step.status === "FAILED") {
      revalidatePath("/shorts");
      revalidatePath("/automations/history");
      revalidatePath("/usage");
    }
    if (step.status === "FAILED") return { error: describeAutomationRunError(step.errorMessage), runId: run.id, pending: false };
    return { success: true, runId: run.id, pending: step.status === "RUNNING" || step.status === "BUSY", progress: step.progress };
  } catch {
    // A transient problem while stepping is retried by the next poll or cron tick.
    return { success: true, runId: run.id, pending: true };
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
  if (!hasVisualAssets(owned.automation.config)) return { error: NEEDS_ASSETS };
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

const DEFAULT_MASCOT_BRIEF = "이지 마케팅 서비스(마케팅 진단, 콘텐츠 캘린더, 블로그 글, 광고 영상을 AI가 만들어 줘요)를 사장님께 소개하는 친근한 광고 영상";

type ConfigPatch = { assets?: ShortsAsset[]; shortsBrief?: string; durationSec?: number; voiceMode?: VoiceMode };

/**
 * Writes the Shorts settings into `automations.config`, keeping every other key (platforms …). Photos saved by the
 * older reference list are carried over into `assets` the first time anything is written.
 */
async function writeShortsConfig(owned: OwnedShorts, patch: ConfigPatch): Promise<string | null> {
  const current = owned.automation.config && typeof owned.automation.config === "object" && !Array.isArray(owned.automation.config)
    ? owned.automation.config as Record<string, Json | undefined>
    : {};
  const { references: legacyReferences, ...rest } = current;
  void legacyReferences;
  const assets = patch.assets ?? parseShortsSettings(owned.automation.config).assets;
  const { error } = await owned.supabase.from("automations").update({
    config: { ...rest, ...patch, assets } as unknown as Json,
  }).eq("id", owned.automation.id).eq("user_id", owned.user.id);
  if (error) return "설정을 저장하지 못했어요. 잠시 후 다시 시도해주세요.";
  revalidatePath(owned.slug === "blog-marketing" ? "/blog" : "/shorts");
  return null;
}

export interface ShortsUploadTicket extends ShortsActionResult {
  assetId?: string;
  path?: string;
  token?: string;
  bucket?: string;
}

function extensionOf(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
}

/**
 * Step 1 of adding a file: checks what the owner is about to send and hands the browser a one-time URL to upload to
 * directly (a video does not fit through a Server Action). The file is not part of the settings until step 2.
 */
export async function createShortsAssetUpload(
  automationId: string,
  input: { kind: string; fileName: string; mime: string; bytes: number },
): Promise<ShortsUploadTicket> {
  const owned = await ownedShortsAutomation(automationId, REFERENCE_TEMPLATES);
  if ("error" in owned) return { error: owned.error };
  if (!(input.kind in ASSET_LIMITS)) return { error: "올릴 파일의 종류를 확인해주세요." };
  const kind = input.kind as ShortsAssetKind;
  if (owned.slug === "blog-marketing" && kind !== "image") return { error: "블로그에는 사진만 올릴 수 있어요." };
  const limits = ASSET_LIMITS[kind];
  const extension = extensionOf(input.fileName);
  if (!(limits.extensions as readonly string[]).includes(extension)) return { error: `이 칸에는 ${limits.label} 파일만 올릴 수 있어요.` };
  if (input.mime && !(limits.mimes as readonly string[]).includes(input.mime)) return { error: `이 칸에는 ${limits.label} 파일만 올릴 수 있어요.` };
  const settings = parseShortsSettings(owned.automation.config);
  // Count and size are known now; the length of a video or an audio file only after the upload (registerShortsAsset).
  const early = checkAssetBasics({ kind, size: Math.max(1, Math.floor(input.bytes)), existing: settings.assets });
  if (early) return { error: early };

  const assetId = crypto.randomUUID();
  const path = assetStoragePath(owned.user.id, automationId, assetId, extension === "jpeg" ? "jpg" : extension);
  try {
    const ticket = await createAssetUpload(createAdminClient(), path);
    return { success: true, assetId, path: ticket.path, token: ticket.token, bucket: REFERENCE_BUCKET };
  } catch {
    return { error: "업로드를 준비하지 못했어요. 잠시 후 다시 시도해주세요." };
  }
}

/** Step 2: the file is in Storage. Recognise it by its bytes, measure it, check the limits, then add it to the settings. */
export async function registerShortsAsset(
  automationId: string,
  input: { assetId: string; path: string; kind: string; label?: string; role?: string },
): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId, REFERENCE_TEMPLATES);
  if ("error" in owned) return { error: owned.error };
  if (!(input.kind in ASSET_LIMITS)) return { error: "올릴 파일의 종류를 확인해주세요." };
  const kind = input.kind as ShortsAssetKind;
  if (owned.slug === "blog-marketing" && kind !== "image") return { error: "블로그에는 사진만 올릴 수 있어요." };
  const prefix = `${owned.user.id}/${automationId}/assets/${input.assetId}.`;
  if (!input.path.startsWith(prefix) || input.path.includes("..") || !/^[0-9a-f-]{36}$/.test(input.assetId)) return { error: "올린 파일 정보가 올바르지 않아요. 다시 올려주세요." };

  const admin = createAdminClient();
  const discard = async (error: string): Promise<ShortsActionResult> => {
    await removeAssets(admin, [input.path]).catch(() => undefined);
    return { error };
  };
  const stored = await readAssetHead(admin, input.path);
  if (!stored) return { error: "올린 파일을 찾지 못했어요. 다시 올려주세요." };
  const type = detectAssetType(stored.head, kind);
  if (!type) return discard(`${ASSET_LIMITS[kind].label} 파일이 아니에요. 파일 형식을 확인해주세요.`);

  const settings = parseShortsSettings(owned.automation.config);
  let probe;
  if (kind === "video" || kind === "audio") {
    try {
      probe = await getPostprocessProvider().probe(await signAsset(admin, REFERENCE_BUCKET, input.path, 300));
    } catch {
      return discard("파일 정보를 읽지 못했어요. 다른 파일로 다시 올려주세요.");
    }
  }
  const limit = checkAssetLimits({ kind, size: stored.size, existing: settings.assets, probe });
  if (limit) return discard(limit);

  const role = input.role && input.role in ASSET_ROLES ? (input.role as ShortsAssetRole) : undefined;
  const asset: ShortsAsset = {
    id: input.assetId,
    kind,
    origin: "upload",
    source: input.path,
    label: (input.label ?? "").trim().slice(0, ASSET_LABEL_MAX_LENGTH),
    mime: type.mime,
    bytes: stored.size,
    ...(probe ? { durationSec: probe.durationSec, ...(probe.width ? { width: probe.width } : {}), ...(probe.height ? { height: probe.height } : {}), ...(probe.fps ? { fps: probe.fps } : {}) } : {}),
    ...(kind === "image" && role ? { role } : {}),
  };
  const failure = await writeShortsConfig(owned, { assets: [...settings.assets, asset] });
  if (failure) return discard(failure);
  return { success: true };
}

export async function addMascotReferences(automationId: string): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId);
  if ("error" in owned) return { error: owned.error };
  const settings = parseShortsSettings(owned.automation.config);
  const have = new Set(settings.assets.filter((asset) => asset.origin === "mascot").map((asset) => asset.source));
  const room = ASSET_LIMITS.image.max - settings.assets.filter((asset) => asset.kind === "image").length;
  const additions: ShortsAsset[] = MASCOT_POSES.filter((pose) => !have.has(pose.key)).slice(0, Math.max(0, room)).map((pose) => ({
    id: `mascot-${pose.key}`,
    kind: "image",
    origin: "mascot",
    source: pose.key,
    label: pose.label,
    role: "character",
  }));
  if (additions.length === 0) {
    return { error: room <= 0 ? "사진이 가득 찼어요. 일부를 지운 뒤 마스코트를 불러오세요." : "마스코트 이미지를 이미 모두 불러왔어요." };
  }
  const failure = await writeShortsConfig(owned, { assets: [...settings.assets, ...additions], ...(settings.brief ? {} : { shortsBrief: DEFAULT_MASCOT_BRIEF }) });
  return failure ? { error: failure } : { success: true };
}

export async function removeShortsAsset(automationId: string, assetId: string): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId, REFERENCE_TEMPLATES);
  if ("error" in owned) return { error: owned.error };
  const settings = parseShortsSettings(owned.automation.config);
  const target = settings.assets.find((item) => item.id === assetId);
  if (!target) return { success: true };
  const failure = await writeShortsConfig(owned, { assets: settings.assets.filter((item) => item.id !== assetId) });
  if (failure) return { error: failure };
  if (target.origin === "upload" && isOwnedAssetPath(target.source, owned.user.id, automationId)) {
    await removeAssets(createAdminClient(), [target.source]).catch(() => undefined);
  }
  return { success: true };
}

export async function saveShortsSettings(
  automationId: string,
  input: { brief: string; durationSec: number; voiceMode: string },
): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId);
  if ("error" in owned) return { error: owned.error };
  const brief = input.brief.trim();
  if (brief.length > SHORTS_BRIEF_MAX_LENGTH) return { error: `요청 사항은 ${SHORTS_BRIEF_MAX_LENGTH}자 이내로 적어주세요.` };
  const durationSec = Math.round(input.durationSec);
  if (!Number.isFinite(durationSec) || durationSec < SHORTS_DURATION.min || durationSec > SHORTS_DURATION.max) return { error: `영상 길이는 ${SHORTS_DURATION.min}~${SHORTS_DURATION.max}초 사이로 골라주세요.` };
  if (input.voiceMode !== "native" && input.voiceMode !== "tts") return { error: "목소리 방식을 확인해주세요." };
  const failure = await writeShortsConfig(owned, { shortsBrief: brief, durationSec, voiceMode: input.voiceMode });
  return failure ? { error: failure } : { success: true };
}

/** The owner says what a photo is for (the AI fills in the rest when the video is made). */
export async function setAssetRole(automationId: string, assetId: string, role: string): Promise<ShortsActionResult> {
  const owned = await ownedShortsAutomation(automationId, REFERENCE_TEMPLATES);
  if ("error" in owned) return { error: owned.error };
  if (!(role in ASSET_ROLES)) return { error: "사진의 쓰임새를 확인해주세요." };
  const settings = parseShortsSettings(owned.automation.config);
  const target = settings.assets.find((item) => item.id === assetId);
  if (!target || target.kind !== "image" || target.origin === "mascot") return { error: "바꿀 사진을 찾을 수 없어요." };
  const failure = await writeShortsConfig(owned, { assets: settings.assets.map((item) => (item.id === assetId ? { ...item, role: role as ShortsAssetRole } : item)) });
  return failure ? { error: failure } : { success: true };
}


export interface ReusableImage {
  /** `<automationId>:<assetId>` — what to send back to reuseImages. */
  key: string;
  label: string;
  summary: string;
  fromName: string;
  previewUrl: string | null;
}

/** Photos the owner uploaded for this business's other automations (blog or Shorts) that are not in this one yet. */
async function reusableCandidates(owned: OwnedShorts): Promise<Array<{ key: string; asset: ShortsAsset; fromName: string }>> {
  const { data: others } = await owned.supabase.from("automations").select("id,name,config")
    .eq("user_id", owned.user.id).eq("business_id", owned.automation.business_id).neq("id", owned.automation.id).limit(30);
  const have = new Set(parseShortsSettings(owned.automation.config).assets.flatMap((asset) => [asset.source, asset.copiedFrom ?? ""]));
  const seen = new Set<string>();
  const out: Array<{ key: string; asset: ShortsAsset; fromName: string }> = [];
  for (const row of others ?? []) {
    for (const asset of parseShortsSettings(row.config).assets) {
      if (asset.kind !== "image" || asset.origin !== "upload" || !isOwnedAssetPath(asset.source, owned.user.id, row.id)) continue;
      const original = asset.copiedFrom ?? asset.source;
      if (have.has(asset.source) || have.has(original) || seen.has(original)) continue;
      seen.add(original);
      out.push({ key: `${row.id}:${asset.id}`, asset, fromName: row.name });
    }
  }
  return out;
}

export async function listReusableImages(automationId: string): Promise<{ error?: string; images?: ReusableImage[] }> {
  const owned = await ownedShortsAutomation(automationId, REFERENCE_TEMPLATES);
  if ("error" in owned) return { error: owned.error };
  const admin = createAdminClient();
  const candidates = (await reusableCandidates(owned)).slice(0, 24);
  const images = await Promise.all(candidates.map(async ({ key, asset, fromName }): Promise<ReusableImage> => ({
    key,
    label: asset.label,
    summary: asset.summary ?? "",
    fromName,
    previewUrl: await signAsset(admin, REFERENCE_BUCKET, asset.source).catch(() => null),
  })));
  return { images };
}

/** Copies the chosen photos into this automation (a copy, so deleting one place never breaks the other). */
export async function reuseImages(automationId: string, keys: string[]): Promise<ShortsActionResult & { added?: number }> {
  const owned = await ownedShortsAutomation(automationId, REFERENCE_TEMPLATES);
  if ("error" in owned) return { error: owned.error };
  const wanted = new Set(keys.slice(0, ASSET_LIMITS.image.max));
  if (wanted.size === 0) return { error: "다시 쓸 사진을 골라주세요." };
  const settings = parseShortsSettings(owned.automation.config);
  const room = ASSET_LIMITS.image.max - settings.assets.filter((asset) => asset.kind === "image").length;
  if (room <= 0) return { error: `사진은 ${ASSET_LIMITS.image.max}장까지만 쓸 수 있어요. 일부를 지운 뒤 골라주세요.` };
  const picks = (await reusableCandidates(owned)).filter((candidate) => wanted.has(candidate.key)).slice(0, room);
  if (picks.length === 0) return { error: "고른 사진을 찾을 수 없어요. 화면을 새로고침해주세요." };

  const admin = createAdminClient();
  const added: ShortsAsset[] = [];
  const copied: string[] = [];
  for (const { asset } of picks) {
    const id = crypto.randomUUID();
    const extension = extensionOf(asset.source) || "jpg";
    const path = assetStoragePath(owned.user.id, automationId, id, extension);
    const { error } = await admin.storage.from(REFERENCE_BUCKET).copy(asset.source, path);
    if (error) continue;
    copied.push(path);
    added.push({ ...asset, id, source: path, copiedFrom: asset.copiedFrom ?? asset.source });
  }
  if (added.length === 0) return { error: "사진을 가져오지 못했어요. 잠시 후 다시 시도해주세요." };
  const failure = await writeShortsConfig(owned, { assets: [...settings.assets, ...added] });
  if (failure) {
    await removeAssets(admin, copied).catch(() => undefined);
    return { error: failure };
  }
  return { success: true, added: added.length };
}
