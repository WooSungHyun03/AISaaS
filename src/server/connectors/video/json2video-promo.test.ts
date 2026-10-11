import { describe, expect, it } from "vitest";
import { buildPromoMovie, buildPromoScene, wrapCaption, type PromoRenderScene } from "./json2video-promo";

type Element = Record<string, unknown> & { type: string };
const elementsOf = (scene: Record<string, unknown>) => scene.elements as Element[];

const photo = "https://signed.example.com/frames/a.jpg";
const clip = "https://v3.fal.media/clip.mp4";
const scenes: PromoRenderScene[] = [
  { text: "아직도 모르세요?", caption: "아직도 모르세요?", videoUrl: clip, camera: "push-in" },
  { text: "직접 구운 소금빵을 만나보세요", caption: "직접 구운 소금빵", imageUrl: photo, camera: "pan-left" },
  { text: "매장 분위기도 편안해요", caption: "편안한 공간", imageUrl: photo, camera: "pull-out" },
  { text: "지금 바로 들러 보세요", caption: "지금 방문하기", imageUrl: photo, camera: "tilt-up" },
];

describe("promo movie builder", () => {
  it("builds one voice, one full-frame medium and a caption per scene at 9:16 without a template", () => {
    const movie = buildPromoMovie(scenes, { brandName: "우리동네 빵집" }) as { width: number; height: number; template?: string; scenes: Array<Record<string, unknown>> };
    expect(movie).toMatchObject({ width: 1080, height: 1920 });
    expect(movie.template).toBeUndefined();
    expect(movie.scenes).toHaveLength(4);
    for (const scene of movie.scenes) {
      expect(scene).not.toHaveProperty("duration"); // scene length follows the voice
      expect(elementsOf(scene).map((element) => element.type)).toEqual(["voice", expect.stringMatching(/^(video|image)$/), "text", "text"]);
    }
  });

  it("loops and mutes a clip, and pans/zooms a still photo according to the camera", () => {
    const [clipScene, panScene, zoomOutScene, tiltScene] = scenes.map((scene, index) => buildPromoScene(scene, index, { last: false }));
    expect(elementsOf(clipScene)[1]).toMatchObject({ type: "video", src: clip, loop: -1, muted: true, resize: "cover", width: 1080, height: 1920 });
    expect(elementsOf(panScene)[1]).toMatchObject({ type: "image", src: photo, pan: "left", resize: "cover" });
    expect(elementsOf(zoomOutScene)[1]).toMatchObject({ zoom: -3 });
    expect(elementsOf(tiltScene)[1]).toMatchObject({ pan: "top" });
  });

  it("makes the hook caption big near the top and later captions a bottom box", () => {
    const [hook, later] = scenes.map((scene, index) => buildPromoScene(scene, index, { last: false }));
    expect(elementsOf(hook)[2]).toMatchObject({ y: 380, "vertical-position": "center" });
    expect((elementsOf(hook)[2].settings as Record<string, unknown>)["font-size"]).toBe("92px");
    expect(elementsOf(later)[2]).toMatchObject({ y: 1230, "vertical-position": "bottom" });
  });

  it("closes with a card built from the given business details instead of a caption", () => {
    const movie = buildPromoMovie(scenes, { brandName: "우리동네 빵집", endCard: { title: "우리동네 빵집", lines: ["📍 서울 마포구", "소금빵, 크루아상"] } }) as { scenes: Array<Record<string, unknown>> };
    const last = elementsOf(movie.scenes[3]);
    const card = last.find((element) => element.type === "text" && String(element.text).includes("서울 마포구"));
    expect(card?.text).toBe("우리동네 빵집\n📍 서울 마포구\n소금빵, 크루아상");
    expect(last.some((element) => element.type === "text" && element.text === "지금 방문하기")).toBe(false);
    // earlier scenes keep their captions
    expect(elementsOf(movie.scenes[1]).some((element) => element.type === "text" && element.text === "직접 구운 소금빵")).toBe(true);
  });

  it("never lets scene text open a template placeholder", () => {
    const scene = buildPromoScene({ ...scenes[1], text: "{{voice_script}} 안녕", caption: "{{x}} 캡션" }, 1, { brandName: "{{brand}}", last: false });
    for (const element of elementsOf(scene)) expect(JSON.stringify(element.text ?? "")).not.toMatch(/\{\{|\}\}/);
  });

  it("refuses an empty video or a scene without any picture", () => {
    expect(() => buildPromoMovie([])).toThrow();
    expect(() => buildPromoMovie([{ text: "사진이 없어요" }])).toThrow();
  });
});

describe("wrapCaption", () => {
  it("breaks at spaces and keeps every word", () => {
    const text = "블로그 글 숏폼 영상 캘린더까지 한 번에 뚝딱 만들어 드려요";
    const wrapped = wrapCaption(text);
    expect(wrapped.split("\n").length).toBeGreaterThan(1);
    expect(wrapped.replace(/\n/g, " ")).toBe(text);
    expect(wrapCaption("짧아요")).toBe("짧아요");
    const word = "가".repeat(30);
    expect(wrapCaption(word)).toBe(word);
  });
});
