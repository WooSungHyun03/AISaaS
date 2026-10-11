import type { PromoCamera } from "@/server/ai/prompts/shorts";

/**
 * "Promo" Shorts: the owner's own product / menu / shop / office photos full-screen (each framed to 9:16
 * beforehand), either brought to life by an image-to-video clip or panned/zoomed slowly, with one narrator,
 * a short caption per scene, the business name, and a closing call-to-action card.
 * The photos are never regenerated, so a product keeps looking like the real product.
 */

const WIDTH = 1080;
const HEIGHT = 1920;
const FONT_FAMILY = "Noto Sans KR";
const NARRATOR_VOICE = "ko-KR-SunHiNeural";

export interface PromoRenderScene {
  /** Narration (spoken). */
  text: string;
  /** Short on-screen caption; falls back to the narration. */
  caption?: string;
  /** HTTPS URL of the 9:16 framed photo (used when there is no clip). */
  imageUrl?: string;
  /** HTTPS URL of the animated clip for this scene. */
  videoUrl?: string;
  camera?: PromoCamera;
}

export interface PromoEndCard {
  title: string;
  lines: string[];
}

function plain(text: string): string {
  return text.replace(/\{\{|\}\}/g, "").trim();
}

/** JSON2Video wraps text at any character, which splits Korean words; break at spaces ourselves (the text element honours "\n"). */
export function wrapCaption(text: string, maxUnits = 13.5): string {
  const words = plain(text).split(/\s+/).filter(Boolean);
  const width = (word: string) => [...word].reduce((total, char) => total + (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(char) ? 1 : /[A-Za-z0-9]/.test(char) ? 0.62 : 0.45), 0);
  const lines: string[] = [];
  let line = "";
  let lineWidth = 0;
  for (const word of words) {
    const wordWidth = width(word);
    if (line && lineWidth + 0.35 + wordWidth > maxUnits) {
      lines.push(line);
      line = word;
      lineWidth = wordWidth;
    } else {
      lineWidth = line ? lineWidth + 0.35 + wordWidth : wordWidth;
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function cameraProps(camera: PromoCamera): Record<string, unknown> {
  switch (camera) {
    case "push-in":
      return { zoom: 3 };
    case "pull-out":
      return { zoom: -3 };
    case "pan-left":
      return { pan: "left", "pan-distance": 0.1 };
    case "pan-right":
      return { pan: "right", "pan-distance": 0.1 };
    case "tilt-up":
      return { pan: "top", "pan-distance": 0.1 };
    case "tilt-down":
      return { pan: "bottom", "pan-distance": 0.1 };
  }
}

const FULL_FRAME = { position: "custom", resize: "cover", x: 0, y: 0, width: WIDTH, height: HEIGHT } as const;

function mediaElement(scene: PromoRenderScene, fallbackCamera: PromoCamera): Record<string, unknown> {
  if (scene.videoUrl) {
    // The clip already contains the motion; it is cut to the voice and loops if the line is longer than the clip.
    return { type: "video", src: scene.videoUrl, duration: -2, loop: -1, muted: true, ...FULL_FRAME };
  }
  return { type: "image", src: scene.imageUrl, duration: -2, ...FULL_FRAME, ...cameraProps(scene.camera ?? fallbackCamera) };
}

function captionElement(text: string, hook: boolean): Record<string, unknown> {
  return {
    type: "text",
    text: wrapCaption(text, hook ? 10 : 13.5),
    duration: -2,
    position: "custom",
    x: "6%",
    y: hook ? 380 : 1230,
    width: "88%",
    height: hook ? 520 : 460,
    "vertical-position": hook ? "center" : "bottom",
    "horizontal-position": "center",
    "fade-in": 0.2,
    settings: {
      "font-family": FONT_FAMILY,
      "font-size": hook ? "92px" : "64px",
      "font-weight": "800",
      "line-height": "1.25",
      "text-align": "center",
      color: "#FFFFFF",
      "background-color": hook ? "rgba(15,23,42,0.55)" : "rgba(15,23,42,0.72)",
      padding: hook ? "40px 44px" : "36px 40px",
      "border-radius": "44px",
      "text-shadow": "0 3px 12px rgba(0,0,0,0.6)",
    },
  };
}

function brandElement(name: string): Record<string, unknown> {
  return {
    type: "text",
    text: plain(name).slice(0, 24),
    duration: -2,
    position: "custom",
    x: "5%",
    y: 90,
    width: "70%",
    height: 90,
    "vertical-position": "top",
    "horizontal-position": "left",
    settings: { "font-family": FONT_FAMILY, "font-size": "40px", "font-weight": "800", "text-align": "left", color: "#FFFFFF", "text-shadow": "0 2px 8px rgba(0,0,0,0.7)" },
  };
}

function endCardElement(card: PromoEndCard): Record<string, unknown> {
  return {
    type: "text",
    text: [plain(card.title), ...card.lines.map(plain)].filter(Boolean).join("\n"),
    duration: -2,
    position: "custom",
    x: "6%",
    y: 560,
    width: "88%",
    height: 520,
    "vertical-position": "center",
    "horizontal-position": "center",
    "fade-in": 0.3,
    settings: {
      "font-family": FONT_FAMILY,
      "font-size": "58px",
      "font-weight": "800",
      "line-height": "1.45",
      "text-align": "center",
      color: "#0F172A",
      "background-color": "rgba(255,255,255,0.93)",
      padding: "48px 44px",
      "border-radius": "48px",
    },
  };
}

export function buildPromoScene(scene: PromoRenderScene, index: number, options: { brandName?: string; endCard?: PromoEndCard; last: boolean }): Record<string, unknown> {
  const fallbackCamera = (["push-in", "pan-left", "pull-out", "pan-right", "tilt-up", "tilt-down"] as const)[index % 6];
  const elements: Array<Record<string, unknown>> = [
    { type: "voice", text: plain(scene.text), model: "azure", voice: NARRATOR_VOICE, "extra-time": 0.3 },
    mediaElement(scene, fallbackCamera),
  ];
  if (options.last && options.endCard) elements.push(endCardElement(options.endCard));
  else elements.push(captionElement(scene.caption || scene.text, index === 0));
  if (options.brandName?.trim()) elements.push(brandElement(options.brandName));
  return { "background-color": "#0F172A", transition: { type: "xfade", style: "fade", duration: 0.25 }, elements };
}

export function buildPromoMovie(scenes: PromoRenderScene[], options: { brandName?: string; endCard?: PromoEndCard } = {}): Record<string, unknown> {
  if (scenes.length === 0) throw new Error("홍보 영상에는 장면이 한 개 이상 필요합니다.");
  if (scenes.some((scene) => !scene.imageUrl && !scene.videoUrl)) throw new Error("홍보 영상의 모든 장면에는 사진 또는 움직이는 영상이 필요합니다.");
  return {
    resolution: "custom",
    width: WIDTH,
    height: HEIGHT,
    quality: "high",
    scenes: scenes.map((scene, index) => buildPromoScene(scene, index, { ...options, last: index === scenes.length - 1 })),
    "client-data": { source: "autobiz-shorts-promo", scene_count: scenes.length },
  };
}
