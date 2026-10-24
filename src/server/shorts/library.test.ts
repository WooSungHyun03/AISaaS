import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyShortsVideo, downloadFileName, ownsVideoPath, runOutputFacts } from "./library";
import { archiveExternalVideo, isFetchableVideoUrl } from "./library-archive";

describe("classifyShortsVideo", () => {
  it("trusts the path stored on the content row", () => {
    expect(classifyShortsVideo({ video_path: "u/a/r/final.mp4" }, null)).toEqual({ state: "STORED", path: "u/a/r/final.mp4", externalUrl: null });
  });

  it("reads the stored file from the run when the row was written before the library existed", () => {
    expect(classifyShortsVideo({ video_path: null }, { videoPath: "u/a/r/final.mp4", videoUrl: "https://signed.example/x?token=1" })).toMatchObject({ state: "STORED", path: "u/a/r/final.mp4" });
  });

  it("calls an older video that only has a hosted address EXTERNAL, and never one that is not https", () => {
    expect(classifyShortsVideo({ video_path: null }, { videoUrl: "https://cdn.example.com/v.mp4" })).toEqual({ state: "EXTERNAL", path: null, externalUrl: "https://cdn.example.com/v.mp4" });
    expect(classifyShortsVideo({ video_path: null }, { videoUrl: "http://cdn.example.com/v.mp4" }).state).toBe("UNAVAILABLE");
    expect(classifyShortsVideo({ video_path: null }, { videoUrl: "javascript:alert(1)" }).state).toBe("UNAVAILABLE");
  });

  it("marks a test placeholder SAMPLE even though it has an address", () => {
    expect(classifyShortsVideo({ video_path: null }, { videoUrl: "https://samples.example/test.mp4", sampleVideo: true }).state).toBe("SAMPLE");
  });

  it("says UNAVAILABLE (never invents a file) when there is nothing to play", () => {
    expect(classifyShortsVideo({ video_path: null }, null).state).toBe("UNAVAILABLE");
    expect(classifyShortsVideo({ video_path: null }, {}).state).toBe("UNAVAILABLE");
    expect(classifyShortsVideo({ video_path: null }, ["x"]).state).toBe("UNAVAILABLE");
  });
});

describe("runOutputFacts / helpers", () => {
  it("reads the length of the video from the run", () => {
    expect(runOutputFacts({ durationSec: 25 }).durationSec).toBe(25);
    expect(runOutputFacts({ durationSec: "25" }).durationSec).toBeNull();
  });

  it("only trusts a path inside the owner's own automation folder", () => {
    expect(ownsVideoPath("u1/a1/r1/final.mp4", "u1", "a1")).toBe(true);
    expect(ownsVideoPath("u2/a1/r1/final.mp4", "u1", "a1")).toBe(false);
    expect(ownsVideoPath("u1/a1/../u2/a1/r/final.mp4", "u1", "a1")).toBe(false);
  });

  it("names a download after the title without characters a file system rejects", () => {
    expect(downloadFileName("봄 신메뉴: 딸기/라떼?")).toBe("봄 신메뉴 딸기 라떼.mp4");
    expect(downloadFileName("  ")).toBe("easy-marketing-shorts.mp4");
    expect(downloadFileName("a".repeat(200))).toHaveLength(64);
  });
});

describe("isFetchableVideoUrl", () => {
  it.each([
    ["https://v3.fal.media/files/out.mp4", true],
    ["http://v3.fal.media/files/out.mp4", false],
    ["https://127.0.0.1/a.mp4", false],
    ["https://localhost/a.mp4", false],
    ["https://10.0.0.5/a.mp4", false],
    ["https://[::1]/a.mp4", false],
    ["https://metadata.internal/a.mp4", false],
    ["https://user:pw@cdn.example.com/a.mp4", false],
    ["not a url", false],
  ])("%s -> %s", (url, expected) => {
    expect(isFetchableVideoUrl(url)).toBe(expected);
  });
});

describe("archiveExternalVideo", () => {
  afterEach(() => vi.restoreAllMocks());

  const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 1, 2, 3, 4]);
  const params = { url: "https://cdn.example.com/v.mp4", userId: "u1", automationId: "a1", runId: "r1" };

  function fakeAdmin(options: { uploadError?: boolean; size?: number | null } = {}) {
    const upload = vi.fn().mockResolvedValue({ error: options.uploadError ? { message: "boom" } : null });
    const info = vi.fn().mockResolvedValue(options.size === null ? { data: null, error: { message: "nf" } } : { data: { size: options.size ?? MP4.length }, error: null });
    return { admin: { storage: { from: () => ({ upload, info }) } } as never, upload, info };
  }
  const respond = (body: Uint8Array | null, init: ResponseInit = {}) => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body as BodyInit | null, { status: 200, ...init }));

  it("copies a reachable MP4 into the owner's folder and checks it is really stored", async () => {
    respond(MP4);
    const { admin, upload } = fakeAdmin();
    const result = await archiveExternalVideo(admin, params);
    expect(result).toEqual({ ok: true, path: "u1/a1/r1/final.mp4", bytes: MP4.length });
    expect(upload).toHaveBeenCalledWith("u1/a1/r1/final.mp4", expect.any(Uint8Array), expect.objectContaining({ contentType: "video/mp4" }));
  });

  it("reports an address that no longer answers as unrecoverable, and stores nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("gone", { status: 404 }));
    const { admin, upload } = fakeAdmin();
    expect(await archiveExternalVideo(admin, params)).toEqual({ ok: false, reason: "UNREACHABLE" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses something that is not an MP4", async () => {
    respond(new TextEncoder().encode("<html>expired</html>"));
    const { admin, upload } = fakeAdmin();
    expect(await archiveExternalVideo(admin, params)).toEqual({ ok: false, reason: "NOT_A_VIDEO" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("does not call a copy saved unless the file is in Storage afterwards", async () => {
    respond(MP4);
    expect(await archiveExternalVideo(fakeAdmin({ size: null }).admin, params)).toEqual({ ok: false, reason: "SAVE_FAILED" });
    respond(MP4);
    expect(await archiveExternalVideo(fakeAdmin({ uploadError: true }).admin, params)).toEqual({ ok: false, reason: "SAVE_FAILED" });
  });

  it("never fetches an address it should not", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await archiveExternalVideo(fakeAdmin().admin, { ...params, url: "https://127.0.0.1/v.mp4" })).toEqual({ ok: false, reason: "UNREACHABLE" });
    expect(spy).not.toHaveBeenCalled();
  });
});
