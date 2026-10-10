/**
 * "Showcase" Shorts: the owner's own photos (shop, products, office…) shown
 * full-screen with a slow pan/zoom, a short caption and a single narrator.
 * The photos are never altered or re-generated — only moved — so a product
 * always looks like the real product.
 */

const WIDTH = 1080;
const HEIGHT = 1920;
const FONT_FAMILY = "Noto Sans KR";
const NARRATOR_VOICE = "ko-KR-SunHiNeural";

export const SHOWCASE_MOTIONS = ["zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down"] as const;
export type ShowcaseMotion = (typeof SHOWCASE_MOTIONS)[number];

export interface ShowcaseScene {
  /** Narration for this scene (spoken). */
  text: string;
  /** Short on-screen caption; falls back to the narration. */
  caption?: string;
  imageUrl: string;
  motion?: ShowcaseMotion;
}

function plain(text: string): string {
  return text.replace(/\{\{|\}\}/g, "").trim();
}

/** Same word-boundary wrapping idea as the character bubble: JSON2Video would split Korean words mid-syllable. */
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

function motionProps(motion: ShowcaseMotion): Record<string, unknown> {
  switch (motion) {
    case "zoom-in":
      return { zoom: 3 };
    case "zoom-out":
      return { zoom: -3 };
    case "pan-left":
      return { pan: "left", "pan-distance": 0.12 };
    case "pan-right":
      return { pan: "right", "pan-distance": 0.12 };
    case "pan-up":
      return { pan: "top", "pan-distance": 0.12 };
    case "pan-down":
      return { pan: "bottom", "pan-distance": 0.12 };
  }
}

export function buildShowcaseScene(scene: ShowcaseScene, index: number, brandName?: string): Record<string, unknown> {
  const motion = scene.motion ?? SHOWCASE_MOTIONS[index % SHOWCASE_MOTIONS.length];
  const elements: Array<Record<string, unknown>> = [
    { type: "voice", text: plain(scene.text), model: "azure", voice: NARRATOR_VOICE, "extra-time": 0.3 },
    {
      type: "image",
      src: scene.imageUrl,
      duration: -2,
      position: "custom",
      resize: "cover",
      x: 0,
      y: 0,
      width: WIDTH,
      height: HEIGHT,
      ...motionProps(motion),
    },
    {
      type: "text",
      text: wrapCaption(scene.caption || scene.text),
      duration: -2,
      position: "custom",
      x: "6%",
      y: 1230,
      width: "88%",
      height: 460,
      "vertical-position": "bottom",
      "horizontal-position": "center",
      "fade-in": 0.2,
      settings: {
        "font-family": FONT_FAMILY,
        "font-size": "64px",
        "font-weight": "800",
        "line-height": "1.3",
        "text-align": "center",
        color: "#FFFFFF",
        "background-color": "rgba(15,23,42,0.72)",
        padding: "36px 40px",
        "border-radius": "44px",
      },
    },
  ];
  if (brandName?.trim()) {
    elements.push({
      type: "text",
      text: plain(brandName).slice(0, 24),
      duration: -2,
      position: "custom",
      x: "5%",
      y: 90,
      width: "70%",
      height: 90,
      "vertical-position": "top",
      "horizontal-position": "left",
      settings: {
        "font-family": FONT_FAMILY,
        "font-size": "40px",
        "font-weight": "800",
        "text-align": "left",
        color: "#FFFFFF",
        "text-shadow": "0 2px 8px rgba(0,0,0,0.7)",
      },
    });
  }
  return {
    "background-color": "#0F172A",
    transition: { type: "xfade", style: "fade", duration: 0.25 },
    elements,
  };
}

export function buildShowcaseMovie(scenes: ShowcaseScene[], brandName?: string): Record<string, unknown> {
  if (scenes.length === 0) throw new Error("사진 홍보 영상에는 장면이 한 개 이상 필요합니다.");
  return {
    resolution: "custom",
    width: WIDTH,
    height: HEIGHT,
    quality: "high",
    scenes: scenes.map((scene, index) => buildShowcaseScene(scene, index, brandName)),
    "client-data": { source: "autobiz-shorts-showcase", scene_count: scenes.length },
  };
}
