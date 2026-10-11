import { describe, expect, it } from "vitest";
import { buildPromoMovie, buildPromoScene, type PromoRenderScene } from "./json2video-promo";

type Element = Record<string, unknown> & { type: string };
const elementsOf = (scene: Record<string, unknown>) => scene.elements as Element[];

const photo = "https://signed.example.com/frames/a.jpg";
const clip = "https://v3.fal.media/clip.mp4";
const scenes: PromoRenderScene[] = [
  { text: "아직도 모르세요?", videoUrl: clip, camera: "push-in" },
  { text: "직접 구운 소금빵을 만나보세요", imageUrl: photo, camera: "pan-left" },
  { text: "매장 분위기도 편안해요", imageUrl: photo, camera: "pull-out" },
  { text: "지금 바로 들러 보세요", imageUrl: photo, camera: "tilt-up" },
];

describe("promo movie builder", () => {
  it("builds one voice, one full-frame medium and the business name per scene at 9:16 without a template or captions", () => {
    const movie = buildPromoMovie(scenes, { brandName: "우리동네 빵집" }) as { width: number; height: number; template?: string; scenes: Array<Record<string, unknown>> };
    expect(movie).toMatchObject({ width: 1080, height: 1920 });
    expect(movie.template).toBeUndefined();
    expect(movie.scenes).toHaveLength(4);
    for (const scene of movie.scenes) {
      expect(scene).not.toHaveProperty("duration"); // scene length follows the voice
      expect(elementsOf(scene).map((element) => element.type)).toEqual(["voice", expect.stringMatching(/^(video|image)$/), "text"]);
      expect(elementsOf(scene)[2].text).toBe("우리동네 빵집"); // only the small brand tag; the narration is never drawn
    }
  });

  it("loops and mutes a clip, and pans/zooms a still photo according to the camera", () => {
    const [clipScene, panScene, zoomOutScene, tiltScene] = scenes.map((scene, index) => buildPromoScene(scene, index, { last: false }));
    expect(elementsOf(clipScene)[1]).toMatchObject({ type: "video", src: clip, loop: -1, muted: true, resize: "cover", width: 1080, height: 1920 });
    expect(elementsOf(panScene)[1]).toMatchObject({ type: "image", src: photo, pan: "left", resize: "cover" });
    expect(elementsOf(zoomOutScene)[1]).toMatchObject({ zoom: -3 });
    expect(elementsOf(tiltScene)[1]).toMatchObject({ pan: "top" });
  });

  it("closes with a card built from the given business details", () => {
    const movie = buildPromoMovie(scenes, { brandName: "우리동네 빵집", endCard: { title: "우리동네 빵집", lines: ["📍 서울 마포구", "소금빵, 크루아상"] } }) as { scenes: Array<Record<string, unknown>> };
    const last = elementsOf(movie.scenes[3]);
    const card = last.find((element) => element.type === "text" && String(element.text).includes("서울 마포구"));
    expect(card?.text).toBe("우리동네 빵집\n📍 서울 마포구\n소금빵, 크루아상");
    // earlier scenes show no text but the brand tag
    expect(elementsOf(movie.scenes[1]).filter((element) => element.type === "text").map((element) => element.text)).toEqual(["우리동네 빵집"]);
  });

  it("never lets scene text open a template placeholder", () => {
    const scene = buildPromoScene({ ...scenes[1], text: "{{voice_script}} 안녕" }, 1, { brandName: "{{brand}}", last: false });
    for (const element of elementsOf(scene)) expect(JSON.stringify(element.text ?? "")).not.toMatch(/\{\{|\}\}/);
  });

  it("refuses an empty video or a scene without any picture", () => {
    expect(() => buildPromoMovie([])).toThrow();
    expect(() => buildPromoMovie([{ text: "사진이 없어요" }])).toThrow();
  });
});
