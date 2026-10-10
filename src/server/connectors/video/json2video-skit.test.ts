import { describe, expect, it } from "vitest";
import { buildCharacterMovie, buildCharacterScene, isCharacterRender, motionKeyframes, wrapForBubble } from "./json2video-skit";
import { VIDEO_MOTIONS, videoRenderInputSchema, type VideoRenderScene } from "./types";

const base = "https://be-celeb.org/shorts-mascot";
const scenes: VideoRenderScene[] = [
  { text: "사장님, 오늘도 인스타 글 못 올렸죠?", visualPrompt: "x", durationSec: 3, speaker: "partner", motion: "shake", imageUrl: `${base}/point.png` },
  { text: "걱정 마세요! 제가 3분 만에 만들어 드릴게요!", visualPrompt: "x", durationSec: 5, speaker: "main", motion: "pop", imageUrl: `${base}/wave.png` },
  { text: "블로그 글, 숏폼 영상까지 한 번에 뚝딱!", visualPrompt: "x", durationSec: 5, speaker: "main", motion: "bounce", imageUrl: `${base}/thumbs-up.png` },
  { text: "이지 마케팅에서 지금 바로 시작하세요!", visualPrompt: "x", durationSec: 5, speaker: "main", motion: "zoom", imageUrl: `${base}/welcome.png` },
];

type Element = Record<string, unknown> & { type: string };
const elementsOf = (scene: Record<string, unknown>) => scene.elements as Element[];

describe("character movie builder", () => {
  it("detects character renders from the scene image", () => {
    expect(isCharacterRender(scenes)).toBe(true);
    expect(isCharacterRender(scenes.map(({ imageUrl: _imageUrl, ...rest }) => rest))).toBe(false);
  });

  it("builds one voice, one image and one bubble per scene at 9:16 with no template", () => {
    const movie = buildCharacterMovie(scenes) as { width: number; height: number; template?: string; scenes: Array<Record<string, unknown>> };

    expect(movie).toMatchObject({ width: 1080, height: 1920 });
    expect(movie.template).toBeUndefined();
    expect(movie.scenes).toHaveLength(scenes.length);
    for (const [index, scene] of movie.scenes.entries()) {
      expect(scene).not.toHaveProperty("duration"); // scene length follows the voice
      expect(elementsOf(scene).map((element) => element.type)).toEqual(["voice", "image", "text"]);
      expect(elementsOf(scene)[1]).toMatchObject({ src: scenes[index].imageUrl, duration: -2 });
    }
  });

  it("uses different voices for the character and the partner", () => {
    const voices = scenes.map((_, index) => {
      const scene = buildCharacterScene(scenes[index], index, `${base}/wave.png`);
      return elementsOf(scene)[0].voice;
    });
    expect(voices[0]).toBe("ko-KR-InJoonNeural");
    expect(voices[1]).toBe("ko-KR-SunHiNeural");
  });

  it("speaks the plain line but wraps the bubble at word boundaries", () => {
    const scene = buildCharacterScene(scenes[1], 1, `${base}/wave.png`);
    const [voice, , bubble] = elementsOf(scene);
    expect(voice.text).toBe(scenes[1].text);
    expect(String(bubble.text)).toContain("\n");
    expect(String(bubble.text).replace(/\n/g, " ")).toBe(scenes[1].text);
    expect(bubble).toMatchObject({ "vertical-position": "top", y: 140 });
  });

  it("never lets scene text open a template placeholder", () => {
    const scene = buildCharacterScene({ ...scenes[0], text: "{{voice_script}} 안녕하세요" }, 0, `${base}/wave.png`);
    const [voice, , bubble] = elementsOf(scene);
    expect(String(voice.text)).not.toMatch(/\{\{|\}\}/);
    expect(String(bubble.text)).not.toMatch(/\{\{|\}\}/);
  });

  it("falls back to the first reference image and default motions when a scene has none", () => {
    const movie = buildCharacterMovie([scenes[0], { ...scenes[1], imageUrl: undefined, motion: undefined, speaker: undefined }, scenes[2], scenes[3]]);
    const image = elementsOf((movie.scenes as Array<Record<string, unknown>>)[1])[1];
    expect(image.src).toBe(scenes[0].imageUrl);
    expect((image.keyframes as unknown[]).length).toBe(2); // default "pop" for the character
  });

  it("refuses to build without any reference image", () => {
    expect(() => buildCharacterMovie(scenes.map(({ imageUrl: _imageUrl, ...rest }) => rest))).toThrow();
  });

  it("produces ordered, finite keyframes for every motion", () => {
    for (const motion of VIDEO_MOTIONS) {
      const keys = motionKeyframes(motion, { x: 140, y: 720, size: 800 });
      expect(keys.length).toBeGreaterThanOrEqual(2);
      const seconds = keys.filter((key) => typeof key.time === "number").map((key) => key.time as number);
      expect([...seconds].sort((a, b) => a - b)).toEqual(seconds);
      for (const key of keys) {
        expect(["x", "y", "width", "height"].every((name) => Number.isFinite(key[name]))).toBe(true);
      }
    }
  });

  it("is accepted by the shared render input schema", () => {
    expect(videoRenderInputSchema.safeParse({ scenes, voiceScript: scenes.map((scene) => scene.text).join(" ") }).success).toBe(true);
    expect(videoRenderInputSchema.safeParse({
      scenes: scenes.map((scene, index) => (index === 0 ? { ...scene, imageUrl: "http://insecure.example.com/a.png" } : scene)),
      voiceScript: "x",
    }).success).toBe(false);
  });
});

describe("wrapForBubble", () => {
  it("keeps short lines whole", () => {
    expect(wrapForBubble("지금 시작해요!")).toBe("지금 시작해요!");
  });

  it("breaks long lines only at spaces and keeps every word", () => {
    const text = "블로그 글 숏폼 영상 캘린더까지 한 번에 뚝딱 만들어 드려요";
    const wrapped = wrapForBubble(text);
    expect(wrapped.split("\n").length).toBeGreaterThan(1);
    expect(wrapped.replace(/\n/g, " ")).toBe(text);
  });

  it("leaves a single over-long word alone instead of dropping it", () => {
    const word = "가".repeat(30);
    expect(wrapForBubble(word)).toBe(word);
  });
});
