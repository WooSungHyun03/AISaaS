import { describe, expect, it } from "vitest";
import { buildCharacterMovie, buildCharacterScene, motionKeyframes } from "./json2video-skit";
import { VIDEO_MOTIONS, videoRenderSceneSchema, type VideoRenderScene } from "./types";

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
  it("builds one voice and one image per scene at 9:16 with no template and no captions", () => {
    const movie = buildCharacterMovie(scenes) as { width: number; height: number; template?: string; scenes: Array<Record<string, unknown>> };

    expect(movie).toMatchObject({ width: 1080, height: 1920 });
    expect(movie.template).toBeUndefined();
    expect(movie.scenes).toHaveLength(scenes.length);
    for (const [index, scene] of movie.scenes.entries()) {
      expect(scene).not.toHaveProperty("duration"); // scene length follows the voice
      expect(elementsOf(scene).map((element) => element.type)).toEqual(["voice", "image"]);
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

  it("speaks the plain line and shows no text on screen", () => {
    const scene = buildCharacterScene(scenes[1], 1, `${base}/wave.png`);
    const [voice] = elementsOf(scene);
    expect(voice.text).toBe(scenes[1].text);
    expect(elementsOf(scene).some((element) => element.type === "text")).toBe(false);
  });

  it("never lets scene text open a template placeholder", () => {
    const scene = buildCharacterScene({ ...scenes[0], text: "{{voice_script}} 안녕하세요" }, 0, `${base}/wave.png`);
    const [voice] = elementsOf(scene);
    expect(String(voice.text)).not.toMatch(/\{\{|\}\}/);
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

  it("builds an animated-clip scene (video instead of image) that loops and is muted", () => {
    const clip = "https://v3.fal.media/clip.mp4";
    const scene = buildCharacterScene({ ...scenes[1], imageUrl: undefined, videoUrl: clip }, 1, "");
    const [voice, media] = elementsOf(scene);
    expect(elementsOf(scene).map((element) => element.type)).toEqual(["voice", "video"]);
    expect(media).toMatchObject({ src: clip, loop: -1, muted: true, duration: -2, resize: "cover", width: 1080, height: 1920 });
    expect(voice.text).toBe(scenes[1].text);
  });

  it("is accepted by the shared scene schema", () => {
    expect(scenes.every((scene) => videoRenderSceneSchema.safeParse(scene).success)).toBe(true);
  });
});
