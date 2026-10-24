import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * The Shorts library against a real database, RLS and Storage (migration 0077): who sees which video, one item per
 * run, pagination, the backfill of existing rows, and a stored file that can be signed again and downloaded.
 * Needs `bash scripts/dev-db.sh` (and ffmpeg for a real MP4); skipped otherwise (RUN_DB_TESTS=1 to run).
 */
function localEnv(): Record<string, string> | null {
  try {
    const text = readFileSync(path.join(process.cwd(), ".env.local.supabase"), "utf8");
    return Object.fromEntries(text.split(/\r?\n/).map((line) => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, "")]));
  } catch {
    return null;
  }
}
const env = process.env.RUN_DB_TESTS ? localEnv() : null;
const suite = env ? describe : describe.skip;
type Db = SupabaseClient<Database>;
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const state = vi.hoisted(() => ({ admin: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? "supabase_db_autobiz-dev-db";
const psql = (query: string) => execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1"], { input: query, encoding: "utf8" }).trim();
// A tiny but real MP4 (ftyp box); the library never decodes it, Storage only has to hold and serve it.
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31, ...new Array(2000).fill(7)]);

suite("shorts library (database, RLS, Storage)", () => {
  const admin: Db = createClient<Database>(env?.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost", env?.SUPABASE_SERVICE_ROLE_KEY ?? "x", options);
  state.admin = admin;
  const owners: Array<{ id: string; db: Db; businessId: string; automationId: string }> = [];
  const folders: string[] = [];

  async function newOwner() {
    const email = `lib-${randomUUID().slice(0, 8)}@autobiz.local`;
    const created = await admin.auth.admin.createUser({ email, password: "Library-test-1!", email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("user not created");
    const db = createClient<Database>(env!.NEXT_PUBLIC_SUPABASE_URL, env!.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
    const signedIn = await db.auth.signInWithPassword({ email, password: "Library-test-1!" });
    if (signedIn.error) throw signedIn.error;
    const business = await admin.from("businesses").insert({ owner_id: created.data.user.id, name: `영상 테스트 ${email.slice(4, 8)}` }).select("id").single();
    const template = await admin.from("automation_templates").select("id").eq("slug", "shorts").single();
    const automation = await admin.from("automations").insert({ user_id: created.data.user.id, business_id: business.data!.id, template_id: template.data!.id, name: "숏폼", status: "DRAFT", schedule: { frequency: "DAILY", timeOfDay: "18:00", timezone: "Asia/Seoul" } }).select("id").single();
    if (automation.error) throw automation.error;
    const owner = { id: created.data.user.id, db, businessId: business.data!.id, automationId: automation.data.id };
    owners.push(owner);
    return owner;
  }

  async function addShort(owner: (typeof owners)[number], over: { output?: Record<string, unknown>; videoPath?: string | null; createdAt?: string; title?: string; source?: "MANUAL" | "SCHEDULED" } = {}) {
    const run = await admin.from("automation_runs").insert({ automation_id: owner.automationId, status: "SUCCESS", source: over.source ?? "MANUAL", output: (over.output ?? {}) as never }).select("id").single();
    if (run.error) throw run.error;
    const content = await admin.from("content_history").insert({ business_id: owner.businessId, automation_id: owner.automationId, run_id: run.data.id, content_type: "shorts", title: over.title ?? "테스트 영상", content: "대본", video_path: over.videoPath ?? null, video_duration_sec: over.videoPath ? 25 : null, ...(over.createdAt ? { created_at: over.createdAt } : {}) }).select("id").single();
    if (content.error) throw content.error;
    return { runId: run.data.id, contentId: content.data.id };
  }

  async function storeVideo(owner: (typeof owners)[number], runId: string) {
    const videoPath = `${owner.id}/${owner.automationId}/${runId}/final.mp4`;
    await admin.storage.createBucket("shorts-videos", { public: false }).catch(() => undefined);
    const { error } = await admin.storage.from("shorts-videos").upload(videoPath, MP4, { contentType: "video/mp4", upsert: true });
    if (error) throw error;
    folders.push(`${owner.id}/${owner.automationId}/${runId}`);
    return videoPath;
  }

  afterAll(async () => {
    for (const folder of folders) {
      const listed = await admin.storage.from("shorts-videos").list(folder);
      const files = (listed.data ?? []).map((file) => `${folder}/${file.name}`);
      if (files.length > 0) await admin.storage.from("shorts-videos").remove(files);
    }
    for (const owner of owners) await admin.auth.admin.deleteUser(owner.id);
  });

  let a: (typeof owners)[number];
  let b: (typeof owners)[number];
  beforeAll(async () => {
    a = await newOwner();
    b = await newOwner();
  });

  it("lists an owner's videos newest first with their state, and never another owner's", async () => {
    const { listShortsLibrary } = await import("./library");
    const stored = await addShort(a, { title: "저장된 영상", createdAt: "2026-10-03T00:00:00Z" });
    const videoPath = await storeVideo(a, stored.runId);
    await admin.from("content_history").update({ video_path: videoPath, video_duration_sec: 25, video_bytes: MP4.length }).eq("id", stored.contentId);
    await addShort(a, { title: "예전 방식 영상", createdAt: "2026-10-02T00:00:00Z", output: { videoUrl: "https://cdn.example.com/old.mp4" } });
    await addShort(a, { title: "파일 없는 영상", createdAt: "2026-10-01T00:00:00Z", output: {} });
    await addShort(b, { title: "남의 영상", createdAt: "2026-10-04T00:00:00Z", videoPath: "someone/else/final.mp4" });

    const mine = await listShortsLibrary(a.db, a.id, 1);
    expect(mine.items.map((item) => [item.title, item.state])).toEqual([["저장된 영상", "STORED"], ["예전 방식 영상", "EXTERNAL"], ["파일 없는 영상", "UNAVAILABLE"]]);
    expect(mine.items[0]).toMatchObject({ durationSec: 25, bytes: MP4.length, businessName: expect.stringContaining("영상 테스트") });

    const theirs = await listShortsLibrary(b.db, b.id, 1);
    expect(theirs.items.map((item) => item.title)).toEqual(["남의 영상"]);
  });

  it("answers 'not found' (null) for another owner's video, a malformed id and a missing id", async () => {
    const { getShortsContent } = await import("./library");
    const bs = await addShort(b, { title: "B의 비공개 영상", videoPath: "x/y/z/final.mp4" });
    expect(await getShortsContent(a.db, bs.contentId)).toBeNull();
    expect(await getShortsContent(a.db, "not-a-uuid")).toBeNull();
    expect(await getShortsContent(a.db, randomUUID())).toBeNull();
    expect((await getShortsContent(b.db, bs.contentId))?.title).toBe("B의 비공개 영상");
  });

  it("pages the list 12 at a time without losing or repeating an item", async () => {
    const { listShortsLibrary, LIBRARY_PAGE_SIZE } = await import("./library");
    const owner = await newOwner();
    for (let index = 0; index < 14; index++) await addShort(owner, { title: `영상 ${String(index).padStart(2, "0")}`, createdAt: new Date(Date.UTC(2026, 9, 1, index)).toISOString(), videoPath: `${owner.id}/x/${index}/final.mp4` });
    const first = await listShortsLibrary(owner.db, owner.id, 1);
    const second = await listShortsLibrary(owner.db, owner.id, 2);
    expect(LIBRARY_PAGE_SIZE).toBe(12);
    expect(first).toMatchObject({ total: 14, page: 1, pageCount: 2 });
    expect(first.items).toHaveLength(12);
    expect(second.items).toHaveLength(2);
    const titles = [...first.items, ...second.items].map((item) => item.title);
    expect(new Set(titles).size).toBe(14);
    expect(titles[0]).toBe("영상 13");
    expect(titles[13]).toBe("영상 00");
  });

  it("allows one content item per run: a second 'finished' event for the same run is refused by the database", async () => {
    const one = await addShort(a, { title: "한 번만" });
    const again = await admin.from("content_history").insert({ business_id: a.businessId, automation_id: a.automationId, run_id: one.runId, content_type: "shorts", title: "중복", content: "x" });
    expect(again.error?.code).toBe("23505");
  });

  it("backfills the stored file of an existing Short from its run (the statement of migration 0077), and leaves the rest alone", async () => {
    const existing = await addShort(a, { title: "예전에 저장된 영상", output: { videoPath: `${a.id}/${a.automationId}/old/final.mp4`, durationSec: 25 } });
    const external = await addShort(a, { title: "외부 링크만", output: { videoUrl: "https://cdn.example.com/old.mp4", durationSec: 20 } });
    const unsafe = await addShort(a, { title: "경로가 이상한 영상", output: { videoPath: "../other-user/final.mp4" } });
    const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/0077_shorts_library.sql"), "utf8");
    const backfill = /update public\.content_history as ch[\s\S]*?;\n/.exec(sql)?.[0];
    expect(backfill).toBeTruthy();
    psql(backfill!);
    const rows = await admin.from("content_history").select("id,video_path,video_duration_sec").in("id", [existing.contentId, external.contentId, unsafe.contentId]);
    const byId = new Map((rows.data ?? []).map((row) => [row.id, row]));
    expect(byId.get(existing.contentId)).toMatchObject({ video_path: `${a.id}/${a.automationId}/old/final.mp4`, video_duration_sec: 25 });
    expect(byId.get(external.contentId)?.video_path).toBeNull();
    expect(byId.get(unsafe.contentId)?.video_path).toBeNull();
  });

  it("signs a stored video again on request: playable, downloadable under the title's name, gone after the file is removed", async () => {
    const { downloadFileName, signStoredVideo, videoFileExists } = await import("./library");
    const item = await addShort(a, { title: "다운로드 영상" });
    const videoPath = await storeVideo(a, item.runId);

    expect(await videoFileExists(videoPath)).toBe(true);
    const play = await signStoredVideo(videoPath);
    const playResponse = await fetch(play!, { headers: { Range: "bytes=0-99" } });
    expect([200, 206]).toContain(playResponse.status);
    expect(playResponse.headers.get("content-type")).toContain("video/mp4");

    const download = await signStoredVideo(videoPath, { downloadName: downloadFileName("다운로드 영상") });
    const downloadResponse = await fetch(download!);
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-disposition")).toMatch(/attachment/);
    expect((await downloadResponse.arrayBuffer()).byteLength).toBe(MP4.length);
    // Each request signs its own address (an address minted later works on its own), so an old one expiring never matters.
    const again = await signStoredVideo(videoPath);
    expect((await fetch(again!, { headers: { Range: "bytes=0-9" } })).status).toBeLessThan(300);

    await admin.storage.from("shorts-videos").remove([videoPath]);
    expect(await videoFileExists(videoPath)).toBe(false);
  });
});
