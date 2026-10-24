import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { VIDEO_BUCKET, isOwnedAssetPath, storedVideoSize } from "@/server/shorts/assets";
import type { Database } from "@/types/database.types";
import type { Json } from "@/types/domain";

/**
 * The Shorts library: one finished ad video = one `content_history` row (content_type "shorts") that owns its MP4 in the
 * private `shorts-videos` bucket, exactly like a blog post owns its text. Reads go through the owner's own client (RLS
 * decides what is visible); signing a file and every change use the service role only after that read succeeded.
 */
export const LIBRARY_PAGE_SIZE = 12;
/** A signed address for watching or downloading lives this long; the video/download routes sign a fresh one on every request. */
export const LIBRARY_URL_TTL_SEC = 60 * 60 * 6;

type UserClient = SupabaseClient<Database>;

/**
 * Where a video stands:
 *  - STORED       the MP4 is in our own Storage (plays, downloads)
 *  - EXTERNAL     an older run kept only the address of a file hosted by the video service; it may have expired
 *  - SAMPLE       a test placeholder (no real renderer connected): not a finished Short
 *  - UNAVAILABLE  nothing to play and nothing to recover it from
 */
export type ShortsVideoState = "STORED" | "EXTERNAL" | "SAMPLE" | "UNAVAILABLE";

export interface ShortsVideoSource {
  state: ShortsVideoState;
  /** Storage path of the stored MP4 (STORED). */
  path: string | null;
  /** The old hosted address (EXTERNAL). */
  externalUrl: string | null;
}

interface RunOutputFacts {
  videoPath: string | null;
  videoUrl: string | null;
  sampleVideo: boolean;
  durationSec: number | null;
}

function record(value: Json | null | undefined): Record<string, Json | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function runOutputFacts(output: Json | null | undefined): RunOutputFacts {
  const raw = record(output);
  const text = (value: Json | undefined) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return { videoPath: text(raw?.videoPath), videoUrl: text(raw?.videoUrl), sampleVideo: raw?.sampleVideo === true, durationSec: typeof raw?.durationSec === "number" ? raw.durationSec : null };
}

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/** Decides how a library item's video can be reached, from the content row first and the run that made it second. */
export function classifyShortsVideo(row: { video_path: string | null }, output: Json | null | undefined): ShortsVideoSource {
  const facts = runOutputFacts(output);
  const path = row.video_path ?? facts.videoPath;
  if (path) return { state: "STORED", path, externalUrl: null };
  if (facts.sampleVideo) return { state: "SAMPLE", path: null, externalUrl: null };
  if (facts.videoUrl && isHttpsUrl(facts.videoUrl)) return { state: "EXTERNAL", path: null, externalUrl: facts.videoUrl };
  return { state: "UNAVAILABLE", path: null, externalUrl: null };
}

export interface ShortsLibraryItem {
  id: string;
  runId: string | null;
  businessId: string;
  businessName: string;
  title: string;
  topic: string | null;
  createdAt: string;
  durationSec: number | null;
  bytes: number | null;
  state: ShortsVideoState;
  edited: boolean;
}

export interface ShortsLibraryPage {
  items: ShortsLibraryItem[];
  total: number;
  page: number;
  pageCount: number;
}

const untitled = "제목 없는 영상";

/** Newest first, one page at a time. Older videos whose file facts were never copied onto the row are read from their run. */
export async function listShortsLibrary(supabase: UserClient, userId: string, requestedPage: number): Promise<ShortsLibraryPage> {
  const { data: businesses, error: businessError } = await supabase.from("businesses").select("id,name").eq("owner_id", userId);
  if (businessError) throw new Error("사업체 정보를 불러오지 못했습니다.", { cause: businessError });
  const names = new Map((businesses ?? []).map((business) => [business.id, business.name]));
  const empty: ShortsLibraryPage = { items: [], total: 0, page: 1, pageCount: 1 };
  if (names.size === 0) return empty;

  const page = Math.max(1, Math.floor(requestedPage) || 1);
  const from = (page - 1) * LIBRARY_PAGE_SIZE;
  const { data: rows, count, error } = await supabase
    .from("content_history")
    .select("id,run_id,business_id,title,topic,created_at,edited_at,video_path,video_duration_sec,video_bytes", { count: "exact" })
    .eq("content_type", "shorts")
    .in("business_id", [...names.keys()])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + LIBRARY_PAGE_SIZE - 1);
  if (error) throw new Error("영상 목록을 불러오지 못했습니다.", { cause: error });

  const total = count ?? rows?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / LIBRARY_PAGE_SIZE));
  const needRun = (rows ?? []).filter((row) => !row.video_path && row.run_id);
  const outputs = new Map<string, Json>();
  if (needRun.length > 0) {
    const { data: runs } = await supabase.from("automation_runs").select("id,output").in("id", needRun.map((row) => row.run_id as string));
    for (const run of runs ?? []) outputs.set(run.id, run.output);
  }

  return {
    total,
    page,
    pageCount,
    items: (rows ?? []).map((row) => {
      const source = classifyShortsVideo(row, row.run_id ? outputs.get(row.run_id) : null);
      return {
        id: row.id,
        runId: row.run_id,
        businessId: row.business_id,
        businessName: names.get(row.business_id) ?? "",
        title: row.title?.trim() || untitled,
        topic: row.topic,
        createdAt: row.created_at,
        durationSec: row.video_duration_sec === null ? runOutputFacts(outputs.get(row.run_id ?? "")).durationSec : Number(row.video_duration_sec),
        bytes: row.video_bytes === null ? null : Number(row.video_bytes),
        state: source.state,
        edited: Boolean(row.edited_at),
      };
    }),
  };
}

export interface UnfinishedShort {
  id: string;
  status: "QUEUED" | "RUNNING" | "FAILED";
  createdAt: string;
  errorMessage: string | null;
}

const FAILED_VISIBLE_DAYS = 7;

/** Videos still being made, and the ones that failed in the last week: shown apart from the finished ones, never as completed. */
export async function listUnfinishedShorts(supabase: UserClient, automationIds: string[]): Promise<UnfinishedShort[]> {
  if (automationIds.length === 0) return [];
  const since = new Date(Date.now() - FAILED_VISIBLE_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("automation_runs")
    .select("id,status,created_at,error_message")
    .in("automation_id", automationIds)
    .in("status", ["QUEUED", "RUNNING", "FAILED"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error("제작 중인 영상을 불러오지 못했습니다.", { cause: error });
  return (data ?? []).map((run) => ({ id: run.id, status: run.status as UnfinishedShort["status"], createdAt: run.created_at, errorMessage: run.error_message }));
}

export interface ShortsContentDetail {
  id: string;
  runId: string | null;
  businessId: string;
  automationId: string;
  title: string;
  topic: string | null;
  script: string | null;
  createdAt: string;
  editedAt: string | null;
  publishing: Json | null;
  durationSec: number | null;
  bytes: number | null;
  source: ShortsVideoSource;
  output: Json | null;
}

/** One library item the caller owns (RLS), or null: a wrong id and someone else's id look the same. */
export async function getShortsContent(supabase: UserClient, contentId: string): Promise<ShortsContentDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contentId)) return null;
  const { data: row, error } = await supabase
    .from("content_history")
    .select("id,run_id,business_id,automation_id,title,topic,content,created_at,edited_at,publishing,video_path,video_duration_sec,video_bytes")
    .eq("id", contentId)
    .eq("content_type", "shorts")
    .maybeSingle();
  if (error) throw new Error("영상 정보를 불러오지 못했습니다.", { cause: error });
  if (!row) return null;
  let output: Json | null = null;
  if (row.run_id) {
    const { data: run } = await supabase.from("automation_runs").select("output").eq("id", row.run_id).maybeSingle();
    output = run?.output ?? null;
  }
  return {
    id: row.id,
    runId: row.run_id,
    businessId: row.business_id,
    automationId: row.automation_id,
    title: row.title?.trim() || untitled,
    topic: row.topic,
    script: row.content,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    publishing: row.publishing,
    durationSec: row.video_duration_sec === null ? runOutputFacts(output).durationSec : Number(row.video_duration_sec),
    bytes: row.video_bytes === null ? null : Number(row.video_bytes),
    source: classifyShortsVideo(row, output),
    output,
  };
}

/** A stored path is only trusted when it sits in the owner's own folder of this automation. */
export function ownsVideoPath(path: string, userId: string, automationId: string): boolean {
  return isOwnedAssetPath(path, userId, automationId);
}

/** Is the stored file really there? (The detail page asks; a missing file is shown as lost, never as playable.) */
export async function videoFileExists(path: string): Promise<boolean> {
  return (await storedVideoSize(createAdminClient(), path).catch(() => null)) !== null;
}

/** A fresh address for a stored video; `downloadName` makes the browser save it instead of playing it. Null when it cannot be signed. */
export async function signStoredVideo(path: string, options: { downloadName?: string } = {}): Promise<string | null> {
  const { data, error } = await createAdminClient().storage.from(VIDEO_BUCKET).createSignedUrl(path, LIBRARY_URL_TTL_SEC, options.downloadName ? { download: options.downloadName } : undefined);
  if (error || !data?.signedUrl) {
    logger.warn("shorts_library_sign_failed", { path, message: error?.message });
    return null;
  }
  return data.signedUrl;
}

/** A file name for a download: the title, with nothing a file system or a header could object to. */
export function downloadFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${base || "easy-marketing-shorts"}.mp4`;
}
