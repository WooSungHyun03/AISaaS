import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  createClient: vi.fn(),
  admin: { kind: "admin" },
  revalidate: vi.fn(),
  runNow: vi.fn(),
  advance: vi.fn(),
  createAssetUpload: vi.fn(),
  readAssetHead: vi.fn(),
  removeAssets: vi.fn(),
  signAsset: vi.fn(),
  probe: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.admin }));
vi.mock("@/server/automations/runner", () => ({ runAutomationNow: m.runNow, advanceDeferredRun: m.advance }));
vi.mock("@/server/billing/entitlements", () => ({ canCreateAutomation: vi.fn() }));
vi.mock("@/server/connectors/postprocess", () => ({ getPostprocessProvider: () => ({ probe: m.probe }) }));
vi.mock("@/server/shorts/assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/shorts/assets")>()),
  createAssetUpload: m.createAssetUpload,
  readAssetHead: m.readAssetHead,
  removeAssets: m.removeAssets,
  signAsset: m.signAsset,
}));

const { createShortsAssetUpload, registerShortsAsset, addMascotReferences, removeShortsAsset, saveShortsSettings, setAssetRole, generateShortsPreview, saveShortsSchedule, advanceShortsJob } = await import("./actions");

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const path = (ext: string, id = ASSET_ID) => `user-1/auto-1/assets/${id}.${ext}`;

function setup(config: Record<string, unknown> = {}) {
  const updates: unknown[] = [];
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.update = vi.fn((payload: unknown) => {
      updates.push(payload);
      return builder;
    });
    builder.maybeSingle = vi.fn().mockResolvedValue(
      table === "automations"
        ? { data: { id: "auto-1", user_id: "user-1", business_id: "biz-1", template_id: "tmpl-1", status: "DRAFT", config }, error: null }
        : { data: { slug: "shorts" }, error: null },
    );
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
    return builder;
  });
  m.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }, from });
  return { updates };
}

const savedConfig = (updates: unknown[]) => (updates[0] as { config: Record<string, unknown> }).config;
const image = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "image", origin: "upload", source: path("png", id), label: "", ...extra });

beforeEach(() => {
  vi.resetAllMocks();
  m.createAssetUpload.mockImplementation(async (_admin: unknown, p: string) => ({ path: p, token: "tok" }));
  m.removeAssets.mockResolvedValue(undefined);
  m.signAsset.mockResolvedValue("https://project.supabase.co/sign/x");
});

describe("createShortsAssetUpload (step 1: a one-time upload address)", () => {
  const ask = (input: Partial<{ kind: string; fileName: string; mime: string; bytes: number }> = {}) =>
    createShortsAssetUpload("auto-1", { kind: "image", fileName: "소금빵.JPG", mime: "image/jpeg", bytes: 2_000_000, ...input });

  it("hands out an upload ticket under the owner's own folder", async () => {
    setup();
    const ticket = await ask();
    expect(ticket).toMatchObject({ success: true, bucket: "shorts-references", token: "tok" });
    expect(ticket.path).toMatch(/^user-1\/auto-1\/assets\/[0-9a-f-]{36}\.jpg$/);
    expect(ticket.assetId).toBeTruthy();
  });

  it("refuses a wrong file type, an oversized file and a full slot before anything is uploaded", async () => {
    setup({ assets: Array.from({ length: 10 }, (_, index) => image(`i${index}`)) });
    expect((await ask({ bytes: 1_000 })).error).toContain("10개까지만");
    setup();
    expect((await ask({ fileName: "a.exe", mime: "application/octet-stream" })).error).toContain("파일만 올릴 수 있어요");
    expect((await ask({ kind: "video", fileName: "a.png", mime: "image/png" })).error).toContain("MP4");
    expect((await ask({ bytes: 11 * 1024 * 1024 })).error).toContain("너무 커요");
    expect((await ask({ kind: "banana" })).error).toBeTruthy();
    expect(m.createAssetUpload).not.toHaveBeenCalled();
  });

  it("does nothing for an automation the user does not own", async () => {
    m.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: () => { const b: Record<string, unknown> = {}; b.select = () => b; b.eq = () => b; b.maybeSingle = async () => ({ data: null, error: null }); return b; },
    });
    expect((await ask()).error).toContain("찾을 수 없");
    expect(m.createAssetUpload).not.toHaveBeenCalled();
  });
});

describe("registerShortsAsset (step 2: recognise, measure, check, save)", () => {
  const register = (over: Partial<{ assetId: string; path: string; kind: string; label: string; role: string }> = {}) =>
    registerShortsAsset("auto-1", { assetId: ASSET_ID, path: path("png"), kind: "image", label: "시그니처 소금빵", ...over });

  it("adds a photo recognised by its bytes to the settings, keeping other keys", async () => {
    const { updates } = setup({ platforms: ["youtube"], assets: [image("old")] });
    m.readAssetHead.mockResolvedValue({ head: PNG, size: 123_456 });
    expect(await register({ role: "product" })).toEqual({ success: true });
    const config = savedConfig(updates);
    expect(config.platforms).toEqual(["youtube"]);
    expect((config.assets as Array<Record<string, unknown>>).map((asset) => asset.id)).toEqual(["old", ASSET_ID]);
    expect((config.assets as Array<Record<string, unknown>>)[1]).toMatchObject({ kind: "image", origin: "upload", mime: "image/png", bytes: 123_456, role: "product", label: "시그니처 소금빵" });
  });

  it("deletes the file and says why when the bytes are not what the owner said", async () => {
    setup();
    m.readAssetHead.mockResolvedValue({ head: new TextEncoder().encode("<html>not an image</html>"), size: 30 });
    expect((await register()).error).toContain("파일이 아니에요");
    expect(m.removeAssets).toHaveBeenCalledWith(m.admin, [path("png")]);
  });

  it("measures a reference video, keeps its length for pricing, and rejects one that is too long, too slow or over the 15 s total", async () => {
    const { updates } = setup();
    m.readAssetHead.mockResolvedValue({ head: MP4, size: 5_000_000 });
    m.probe.mockResolvedValue({ durationSec: 9.5, hasVideo: true, hasAudio: true, width: 720, height: 1280, fps: 30 });
    expect(await register({ kind: "video", path: path("mp4") })).toEqual({ success: true });
    expect((savedConfig(updates).assets as Array<Record<string, unknown>>)[0]).toMatchObject({ kind: "video", durationSec: 9.5, fps: 30, width: 720 });

    m.probe.mockResolvedValue({ durationSec: 16, hasVideo: true, hasAudio: true, width: 720, height: 1280, fps: 30 });
    setup();
    expect((await register({ kind: "video", path: path("mp4") })).error).toContain("15초 이내");
    m.probe.mockResolvedValue({ durationSec: 8, hasVideo: true, hasAudio: true, width: 720, height: 1280, fps: 12 });
    expect((await register({ kind: "video", path: path("mp4") })).error).toContain("프레임");
    setup({ assets: [{ id: "v1", kind: "video", origin: "upload", source: path("mp4", "v1"), label: "", durationSec: 10, fps: 30 }] });
    m.probe.mockResolvedValue({ durationSec: 8, hasVideo: true, hasAudio: true, width: 720, height: 1280, fps: 30 });
    expect((await register({ kind: "video", path: path("mp4") })).error).toContain("합쳐서 15초");
    expect(m.removeAssets).toHaveBeenCalled();
  });

  it("refuses a path that is not the owner's own upload", async () => {
    setup();
    expect((await register({ path: "user-2/auto-1/assets/x.png" })).error).toContain("올바르지 않아요");
    expect((await register({ path: `user-1/auto-1/assets/../../user-2/${ASSET_ID}.png` })).error).toContain("올바르지 않아요");
    expect(m.readAssetHead).not.toHaveBeenCalled();
  });

  it("says so when the file never arrived, and removes the file when saving fails", async () => {
    setup();
    m.readAssetHead.mockResolvedValue(null);
    expect((await register()).error).toContain("찾지 못했어요");

    m.readAssetHead.mockResolvedValue({ head: PNG, size: 100 });
    m.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.update = () => b;
        b.maybeSingle = async () => ({ data: table === "automations" ? { id: "auto-1", user_id: "user-1", business_id: "b", template_id: "t", status: "DRAFT", config: {} } : { slug: "shorts" }, error: null });
        b.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: { message: "db down" } }).then(resolve);
        return b;
      },
    });
    expect((await register()).error).toContain("저장하지 못했어요");
    expect(m.removeAssets).toHaveBeenCalledWith(m.admin, [path("png")]);
  });

  it("upgrades photos saved by the older reference list into assets the first time anything is written", async () => {
    const { updates } = setup({ references: [{ id: "r1", kind: "upload", source: "user-1/auto-1/r1.png", label: "예전 사진", subject: "product" }] });
    m.readAssetHead.mockResolvedValue({ head: PNG, size: 100 });
    await register();
    const config = savedConfig(updates);
    expect(config).not.toHaveProperty("references");
    expect((config.assets as Array<Record<string, unknown>>).map((asset) => asset.id)).toEqual(["r1", ASSET_ID]);
    expect((config.assets as Array<Record<string, unknown>>)[0]).toMatchObject({ role: "product", kind: "image" });
  });
});

describe("mascot, removal and settings", () => {
  it("adds the mascot poses up to the photo limit and seeds a brief only when none exists", async () => {
    const { updates } = setup({ assets: Array.from({ length: 5 }, (_, index) => image(`i${index}`)) });
    expect(await addMascotReferences("auto-1")).toEqual({ success: true });
    const config = savedConfig(updates);
    expect((config.assets as unknown[]).length).toBe(10);
    expect(config.shortsBrief).toContain("이지 마케팅");

    const second = setup({ shortsBrief: "내 요청", assets: [image("a")] });
    await addMascotReferences("auto-1");
    expect(savedConfig(second.updates)).not.toHaveProperty("shortsBrief", expect.stringContaining("이지"));

    setup({ assets: Array.from({ length: 10 }, (_, index) => image(`i${index}`)) });
    expect((await addMascotReferences("auto-1")).error).toContain("가득 찼어요");
  });

  it("deletes the stored file only for uploads", async () => {
    const { updates } = setup({ assets: [image("u1"), { id: "mascot-wave", kind: "image", origin: "mascot", source: "wave", label: "인사" }] });
    await removeShortsAsset("auto-1", "u1");
    expect(m.removeAssets).toHaveBeenCalledWith(m.admin, [path("png", "u1")]);
    expect((savedConfig(updates).assets as Array<{ id: string }>).map((asset) => asset.id)).toEqual(["mascot-wave"]);
    m.removeAssets.mockClear();
    await removeShortsAsset("auto-1", "mascot-wave");
    expect(m.removeAssets).not.toHaveBeenCalled();
  });

  it("saves the length (20-30 s), the voice and the request, and rejects anything else", async () => {
    const { updates } = setup();
    expect(await saveShortsSettings("auto-1", { brief: "  신메뉴  ", durationSec: 28, voiceMode: "tts" })).toEqual({ success: true });
    expect(savedConfig(updates)).toMatchObject({ shortsBrief: "신메뉴", durationSec: 28, voiceMode: "tts" });
    for (const durationSec of [19, 31, Number.NaN]) expect((await saveShortsSettings("auto-1", { brief: "", durationSec, voiceMode: "native" })).error).toContain("20~30초");
    expect((await saveShortsSettings("auto-1", { brief: "", durationSec: 25, voiceMode: "robot" })).error).toContain("목소리");
    expect((await saveShortsSettings("auto-1", { brief: "가".repeat(501), durationSec: 25, voiceMode: "native" })).error).toContain("500자");
  });

  it("lets the owner say what an uploaded photo is for, but not a mascot pose or a non-photo", async () => {
    const { updates } = setup({ assets: [image("u1"), { id: "mascot-wave", kind: "image", origin: "mascot", source: "wave", label: "인사" }, { id: "v1", kind: "video", origin: "upload", source: path("mp4", "v1"), label: "", durationSec: 5 }] });
    expect(await setAssetRole("auto-1", "u1", "exact")).toEqual({ success: true });
    expect((savedConfig(updates).assets as Array<{ id: string; role?: string }>).find((asset) => asset.id === "u1")?.role).toBe("exact");
    expect((await setAssetRole("auto-1", "mascot-wave", "product")).error).toBeTruthy();
    expect((await setAssetRole("auto-1", "v1", "product")).error).toBeTruthy();
    expect((await setAssetRole("auto-1", "u1", "banana")).error).toBeTruthy();
  });
});

describe("starting a video and background progress", () => {
  it("will not start a video or save a schedule without a photo or a reference video", async () => {
    setup({ assets: [{ id: "a", kind: "audio", origin: "upload", source: path("mp3", "a"), label: "", durationSec: 5 }] });
    expect((await generateShortsPreview("auto-1")).error).toContain("사진이나 참고 영상을 먼저");
    expect((await saveShortsSchedule("auto-1", new FormData())).error).toContain("사진이나 참고 영상을 먼저");
    expect(m.runNow).not.toHaveBeenCalled();
  });

  it("reports a started video as pending so the page keeps polling", async () => {
    setup({ assets: [image("a")] });
    m.runNow.mockResolvedValue({ runId: "run-1", status: "RUNNING", progress: "영상 만들기를 시작하고 있어요" });
    expect(await generateShortsPreview("auto-1")).toEqual({ success: true, runId: "run-1", pending: true, progress: "영상 만들기를 시작하고 있어요" });
    expect(m.runNow).toHaveBeenCalledWith("auto-1", { shorts: { previewOnly: true } });
  });

  it("shows the budget's own words when the month's budget is used up, instead of a generic failure", async () => {
    setup({ assets: [image("a")] });
    m.runNow.mockResolvedValue({ runId: "run-1", status: "FAILED", errorMessage: "이번 달 제작 예산을 모두 사용해서 더 만들 수 없어요. 이용권은 차감되지 않았어요." });
    expect((await generateShortsPreview("auto-1")).error).toContain("제작 예산");
  });

  it("advances the in-flight run and tells the page whether to keep waiting", async () => {
    setup();
    m.advance.mockResolvedValueOnce({ runId: "run-1", status: "RUNNING", progress: "AI가 영상을 만드는 중이에요" });
    expect(await advanceShortsJob("auto-1")).toMatchObject({ success: true, pending: true, progress: "AI가 영상을 만드는 중이에요" });
    m.advance.mockResolvedValueOnce({ runId: "run-1", status: "SUCCESS" });
    expect(await advanceShortsJob("auto-1")).toMatchObject({ success: true, pending: false });
    m.advance.mockResolvedValueOnce({ runId: "run-1", status: "FAILED", errorMessage: "boom" });
    expect((await advanceShortsJob("auto-1")).error).toBeTruthy();
    m.advance.mockRejectedValueOnce(new Error("transient"));
    expect(await advanceShortsJob("auto-1")).toMatchObject({ success: true, pending: true });
  });
});
