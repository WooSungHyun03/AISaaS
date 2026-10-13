import { describe, expect, it } from "vitest";
import {
  ASSET_LIMITS,
  MASCOT_POSES,
  SHORTS_DURATION,
  assetsOfKind,
  checkPhotoFile,
  summarizeUsedReferences,
  describeAssetForPrompt,
  parseShortsSettings,
  totalSeconds,
  type ShortsAsset,
} from "./shorts-reference";

const image = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "image", origin: "upload", source: `u/a/assets/${id}.png`, label: "", ...extra });

describe("parseShortsSettings", () => {
  it("defaults to no files, 25 seconds, the video's own voice and an empty request", () => {
    const expected = { assets: [], brief: "", durationSec: 25, voiceMode: "native" };
    expect(parseShortsSettings({})).toEqual(expected);
    expect(parseShortsSettings(null)).toEqual(expected);
    expect(parseShortsSettings("junk")).toEqual(expected);
  });

  it("keeps valid files and drops malformed, unknown-mascot, mascot-video and duplicate ones", () => {
    const settings = parseShortsSettings({
      shortsBrief: "  신메뉴 홍보  ",
      assets: [
        image("a", { role: "person", summary: "웃는 사장님" }),
        image("a", { label: "duplicate id" }),
        { id: "m", kind: "image", origin: "mascot", source: "wave", label: "인사" },
        { id: "bad", kind: "image", origin: "mascot", source: "not-a-pose", label: "" },
        { id: "mv", kind: "video", origin: "mascot", source: "wave", label: "" },
        { id: "", kind: "image", source: "x" },
        { id: "k", kind: "gif", source: "x" },
        "junk",
      ],
    });
    expect(settings.brief).toBe("신메뉴 홍보");
    expect(settings.assets.map((asset) => asset.id)).toEqual(["a", "m"]);
    expect(settings.assets[0]).toMatchObject({ role: "person", summary: "웃는 사장님" });
  });

  it("never returns more of a kind than the model accepts, and keeps the kinds apart", () => {
    const images = Array.from({ length: 14 }, (_, index) => image(`i${index}`));
    const videos = Array.from({ length: 8 }, (_, index) => ({ id: `v${index}`, kind: "video", source: `p/${index}.mp4`, durationSec: 2 }));
    const settings = parseShortsSettings({ assets: [...images, ...videos, { id: "l1", kind: "logo", source: "p/l1.png" }, { id: "l2", kind: "logo", source: "p/l2.png" }] });
    expect(assetsOfKind(settings.assets, "image")).toHaveLength(ASSET_LIMITS.image.max);
    expect(assetsOfKind(settings.assets, "video")).toHaveLength(ASSET_LIMITS.video.max);
    expect(assetsOfKind(settings.assets, "logo")).toHaveLength(1);
  });

  it("clamps the length to 20-30 seconds and accepts only the two voice modes", () => {
    expect(parseShortsSettings({ durationSec: 5 }).durationSec).toBe(SHORTS_DURATION.min);
    expect(parseShortsSettings({ durationSec: 99 }).durationSec).toBe(SHORTS_DURATION.max);
    expect(parseShortsSettings({ durationSec: 27.4 }).durationSec).toBe(27);
    expect(parseShortsSettings({ durationSec: "30" }).durationSec).toBe(SHORTS_DURATION.default);
    expect(parseShortsSettings({ voiceMode: "tts" }).voiceMode).toBe("tts");
    expect(parseShortsSettings({ voiceMode: "robot" }).voiceMode).toBe("native");
  });

  it("forces mascots to 'character'", () => {
    const [mascot] = parseShortsSettings({ assets: [{ id: "m", kind: "image", origin: "mascot", source: "cheer", label: "", role: "product" }] }).assets;
    expect(mascot.role).toBe("character");
  });

  it("upgrades the older reference list (uploads and mascots, with their detected subject)", () => {
    const settings = parseShortsSettings({
      references: [
        { id: "r1", kind: "upload", source: "u/a/r1.png", label: "소금빵", subject: "product", summary: "갓 구운 소금빵" },
        { id: "r2", kind: "upload", source: "u/a/r2.png", label: "" },
        { id: "mascot-wave", kind: "mascot", source: "wave", label: "인사", subject: "character" },
      ],
    });
    expect(settings.assets).toEqual([
      expect.objectContaining({ id: "r1", kind: "image", origin: "upload", role: "product", summary: "갓 구운 소금빵" }),
      expect.objectContaining({ id: "r2", kind: "image", origin: "upload" }),
      expect.objectContaining({ id: "mascot-wave", kind: "image", origin: "mascot", role: "character" }),
    ]);
    expect(settings.assets[1].role).toBeUndefined();
  });
});

describe("helpers", () => {
  const assets = [
    { id: "v1", kind: "video", origin: "upload", source: "a", label: "", durationSec: 6.5 },
    { id: "v2", kind: "video", origin: "upload", source: "b", label: "", durationSec: 8 },
    { id: "a1", kind: "audio", origin: "upload", source: "c", label: "", durationSec: 4 },
    { id: "i1", kind: "image", origin: "upload", source: "d", label: "" },
  ] as ShortsAsset[];

  it("adds up the seconds of reference video and audio (the part the model bills on top of the output)", () => {
    expect(totalSeconds(assets, "video")).toBe(14.5);
    expect(totalSeconds(assets, "audio")).toBe(4);
    expect(totalSeconds([], "video")).toBe(0);
  });

  it("describes a photo to the planner by its role, the AI's summary and the owner's words", () => {
    expect(describeAssetForPrompt({ id: "i", kind: "image", origin: "upload", source: "x", label: "시그니처", role: "product", summary: "갓 구운 소금빵" })).toBe("[product] 갓 구운 소금빵 (사장님 설명: 시그니처)");
    expect(describeAssetForPrompt({ id: "i", kind: "image", origin: "upload", source: "x", label: "" })).toBe("[other] 사용자가 올린 참고 이미지");
    expect(describeAssetForPrompt({ id: "m", kind: "image", origin: "mascot", source: "wave", label: "" })).toContain("마스코트");
    expect(MASCOT_POSES).toHaveLength(8);
  });
});

describe("reference photos", () => {
  it("checks a photo before it is sent: type, size, emptiness and HEIC get a reason in Korean", () => {
    const MB = 1024 * 1024;
    expect(checkPhotoFile({ name: "a.JPG", size: 2 * MB, type: "image/jpeg" })).toBeNull();
    expect(checkPhotoFile({ name: "a.webp", size: 1, type: "" })).toBeNull();
    expect(checkPhotoFile({ name: "a.heic", size: 2 * MB, type: "image/heic" })).toContain("HEIC");
    expect(checkPhotoFile({ name: "a.gif", size: 100, type: "image/gif" })).toContain("JPG·PNG·WEBP");
    expect(checkPhotoFile({ name: "a.png", size: 100, type: "application/pdf" })).toContain("JPG·PNG·WEBP");
    expect(checkPhotoFile({ name: "a.png", size: 0, type: "image/png" })).toContain("빈 파일");
    expect(checkPhotoFile({ name: "a.png", size: 11 * MB, type: "image/png" })).toContain("10MB");
  });

  it("numbers the used references per kind and never exposes more than the private path", () => {
    const parsed = parseShortsSettings({
      assets: [image("a", { label: "빵", summary: "소금빵", role: "product" }), { id: "v", kind: "video", origin: "upload", source: "u/a/assets/v.mp4", label: "" }, image("b")],
    });
    expect(summarizeUsedReferences(parsed.assets)).toEqual([
      { number: 1, id: "a", kind: "image", origin: "upload", label: "빵", role: "product", summary: "소금빵", path: "u/a/assets/a.png" },
      { number: 1, id: "v", kind: "video", origin: "upload", label: "", role: null, summary: "", path: "u/a/assets/v.mp4" },
      { number: 2, id: "b", kind: "image", origin: "upload", label: "", role: null, summary: "", path: "u/a/assets/b.png" },
    ]);
    const mascot = parseShortsSettings({ assets: [{ id: "mascot-wave", kind: "image", origin: "mascot", source: "wave", label: "인사" }] });
    expect(summarizeUsedReferences(mascot.assets)[0]).toMatchObject({ origin: "mascot", role: "character", path: null });
  });
});
