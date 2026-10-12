import { describe, expect, it } from "vitest";
import { assetStoragePath, checkAssetBasics, checkAssetLimits, detectAssetType, isOwnedAssetPath, isSafeSvg, videoStoragePath } from "./assets";
import type { ShortsAsset } from "@/types/shorts-reference";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
const WAV = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45);
const MP4 = bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
const MOV = bytes(0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20);
const MP3_ID3 = bytes(0x49, 0x44, 0x33, 3, 0, 0);
const MP3_FRAME = bytes(0xff, 0xfb, 0x90, 0x00);

describe("detectAssetType", () => {
  it("recognises photos, video, audio and logos by their first bytes, and only as the kind the owner meant", () => {
    expect(detectAssetType(PNG, "image")).toMatchObject({ mime: "image/png", extension: "png" });
    expect(detectAssetType(JPEG, "image")).toMatchObject({ mime: "image/jpeg", extension: "jpg" });
    expect(detectAssetType(WEBP, "image")).toMatchObject({ mime: "image/webp", extension: "webp" });
    expect(detectAssetType(MP4, "video")).toMatchObject({ mime: "video/mp4", extension: "mp4" });
    expect(detectAssetType(MOV, "video")).toMatchObject({ mime: "video/quicktime", extension: "mov" });
    expect(detectAssetType(MP3_ID3, "audio")).toMatchObject({ mime: "audio/mpeg" });
    expect(detectAssetType(MP3_FRAME, "audio")).toMatchObject({ mime: "audio/mpeg" });
    expect(detectAssetType(WAV, "audio")).toMatchObject({ mime: "audio/wav", extension: "wav" });
    expect(detectAssetType(PNG, "logo")).toMatchObject({ mime: "image/png" });
    // A video sent as a photo, a photo sent as audio, a WAV sent as a photo: all refused.
    expect(detectAssetType(MP4, "image")).toBeNull();
    expect(detectAssetType(PNG, "audio")).toBeNull();
    expect(detectAssetType(WAV, "image")).toBeNull();
    expect(detectAssetType(PNG, "video")).toBeNull();
  });

  it("refuses scripts, HTML and empty files whatever they are called", () => {
    for (const kind of ["image", "video", "audio", "logo"] as const) {
      expect(detectAssetType(text("<html><script>alert(1)</script></html>"), kind)).toBeNull();
      expect(detectAssetType(bytes(), kind)).toBeNull();
    }
    expect(detectAssetType(text("GIF89a......"), "image")).toBeNull();
  });

  it("accepts a plain SVG logo and refuses one that can run code or fetch files", () => {
    expect(detectAssetType(text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>'), "logo")).toMatchObject({ mime: "image/svg+xml", extension: "svg" });
    for (const evil of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="file:///etc/passwd"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="http://x"/></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg></svg>',
    ]) {
      expect(isSafeSvg(evil), evil).toBe(false);
      expect(detectAssetType(text(evil), "logo")).toBeNull();
    }
    expect(detectAssetType(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "image")).toBeNull(); // SVG is only for logos
  });
});

describe("storage paths", () => {
  it("nests files under user and automation, and videos under the run", () => {
    expect(assetStoragePath("user-1", "auto-1", "id-1", "mp4")).toBe("user-1/auto-1/assets/id-1.mp4");
    expect(videoStoragePath("user-1", "auto-1", "run-1", "final.mp4")).toBe("user-1/auto-1/run-1/final.mp4");
    expect(isOwnedAssetPath("user-1/auto-1/assets/id-1.mp4", "user-1", "auto-1")).toBe(true);
    expect(isOwnedAssetPath("user-1/auto-1/legacy.png", "user-1", "auto-1")).toBe(true);
  });

  it("refuses paths of someone else or with traversal", () => {
    expect(isOwnedAssetPath("user-2/auto-1/x.png", "user-1", "auto-1")).toBe(false);
    expect(isOwnedAssetPath("user-1/auto-2/x.png", "user-1", "auto-1")).toBe(false);
    expect(isOwnedAssetPath("user-1/auto-1/../user-2/x.png", "user-1", "auto-1")).toBe(false);
  });
});

describe("upload limits", () => {
  const asset = (kind: ShortsAsset["kind"], durationSec?: number): ShortsAsset => ({ id: `${kind}${durationSec}`, kind, origin: "upload", source: "p", label: "", durationSec });
  const video = { hasVideo: true, hasAudio: true, fps: 30 };

  it("limits how many files of each kind there can be, and how big", () => {
    expect(checkAssetBasics({ kind: "image", size: 1_000, existing: [] })).toBeNull();
    expect(checkAssetBasics({ kind: "image", size: 1_000, existing: Array.from({ length: 10 }, () => asset("image")) })).toContain("10개");
    expect(checkAssetBasics({ kind: "video", size: 1_000, existing: Array.from({ length: 5 }, () => asset("video", 2)) })).toContain("5개");
    expect(checkAssetBasics({ kind: "logo", size: 1_000, existing: [asset("logo")] })).toContain("1개");
    expect(checkAssetBasics({ kind: "image", size: 10 * 1024 * 1024 + 1, existing: [] })).toContain("너무 커요");
    expect(checkAssetBasics({ kind: "image", size: 0, existing: [] })).toContain("빈 파일");
  });

  it("keeps reference videos within 15 s each and 15 s in total, and at 16 fps or more", () => {
    const check = (durationSec: number, existing: ShortsAsset[] = [], extra: Partial<typeof video> = {}) => checkAssetLimits({ kind: "video", size: 1_000_000, existing, probe: { durationSec, ...video, ...extra } });
    expect(check(15)).toBeNull();
    expect(check(15.5)).toContain("15초 이내");
    expect(check(5, [asset("video", 10)])).toBeNull();
    expect(check(5.1, [asset("video", 10)])).toContain("합쳐서 15초");
    expect(check(5, [], { fps: 15 })).toContain("프레임");
    expect(check(5, [], { hasVideo: false })).toContain("영상 화면");
    expect(check(0)).toContain("길이");
    expect(checkAssetLimits({ kind: "video", size: 1_000, existing: [] })).toContain("파일 정보");
  });

  it("keeps audio within 15 s each and in total, and needs a sound track", () => {
    const check = (durationSec: number, existing: ShortsAsset[] = [], hasAudio = true) => checkAssetLimits({ kind: "audio", size: 1_000_000, existing, probe: { durationSec, hasVideo: false, hasAudio, fps: null } });
    expect(check(15)).toBeNull();
    expect(check(16)).toContain("15초 이내");
    expect(check(8, [asset("audio", 8)])).toContain("합쳐서 15초");
    expect(check(5, [], false)).toContain("소리가 없는");
  });
});
