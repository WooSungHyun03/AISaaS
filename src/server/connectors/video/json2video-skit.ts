import type { VideoMotion, VideoRenderScene, VideoSpeaker } from "./types";

/**
 * Builds the full JSON2Video movie for "character" Shorts: every scene shows a
 * reference image (the character) that moves with a simple tween, a speech
 * bubble, and its own voice-over line. Unlike the template flow, scene length
 * is whatever the voice needs (`duration: -1`), so the picture can never drift
 * from the audio.
 *
 * This is a 2D tween of the reference image (pop / bounce / shake …), not a
 * generated animation — the character keeps the exact look of the images the
 * owner supplied.
 */

const WIDTH = 1080;
const HEIGHT = 1920;
const FONT_FAMILY = "Noto Sans KR";
const SCENE_BACKGROUNDS = ["#1E3A8A", "#312E81", "#0F766E", "#7C2D12", "#4C1D95", "#164E63"];
const VOICES: Record<VideoSpeaker, string> = {
  main: "ko-KR-SunHiNeural",
  partner: "ko-KR-InJoonNeural",
};
const BUBBLES: Record<VideoSpeaker, { background: string; color: string }> = {
  main: { background: "#FFFFFF", color: "#0F172A" },
  partner: { background: "#FACC15", color: "#1C1917" },
};

interface Frame {
  x: number;
  y: number;
  size: number;
}

/** Where the character sits: large and centred when it talks, smaller in the corner when it listens. */
function baseFrame(speaker: VideoSpeaker): Frame {
  return speaker === "main"
    ? { size: 800, x: (WIDTH - 800) / 2, y: 720 }
    : { size: 620, x: WIDTH - 620 - 60, y: 900 };
}

type Keyframe = Record<string, number | string>;

function frameKeys(time: number | string, frame: Frame, easing: string): Keyframe {
  return { time, x: Math.round(frame.x), y: Math.round(frame.y), width: Math.round(frame.size), height: Math.round(frame.size), easing };
}

function scaled(frame: Frame, factor: number): Frame {
  const size = frame.size * factor;
  return { size, x: frame.x + (frame.size - size) / 2, y: frame.y + (frame.size - size) / 2 };
}

/** Keyframes for each motion. Percent times scale with the scene, so they work for any voice length. */
export function motionKeyframes(motion: VideoMotion, frame: Frame): Keyframe[] {
  switch (motion) {
    case "pop":
      return [frameKeys(0, scaled(frame, 0.5), "linear"), frameKeys(0.55, frame, "ease-out-elastic")];
    case "bounce": {
      const up: Frame = { ...frame, y: frame.y - 120 };
      return [
        frameKeys("0%", frame, "linear"),
        frameKeys("14%", up, "ease-in-out-sine"),
        frameKeys("28%", frame, "ease-in-out-sine"),
        frameKeys("52%", up, "ease-in-out-sine"),
        frameKeys("66%", frame, "ease-in-out-sine"),
      ];
    }
    case "wobble": {
      const left: Frame = { ...frame, x: frame.x - 45 };
      const right: Frame = { ...frame, x: frame.x + 45 };
      return [
        frameKeys("0%", left, "linear"),
        frameKeys("25%", right, "ease-in-out-sine"),
        frameKeys("50%", left, "ease-in-out-sine"),
        frameKeys("75%", right, "ease-in-out-sine"),
        frameKeys("100%", left, "ease-in-out-sine"),
      ];
    }
    case "shake": {
      const keys: Keyframe[] = [frameKeys(0, frame, "linear")];
      for (let step = 1; step <= 6; step++) {
        const offset = step % 2 === 0 ? -34 : 34;
        keys.push(frameKeys(Number((step * 0.08).toFixed(2)), { ...frame, x: frame.x + offset }, "linear"));
      }
      keys.push(frameKeys(0.6, frame, "linear"));
      return keys;
    }
    case "slide":
      return [
        frameKeys(0, { ...frame, x: -frame.size }, "linear"),
        frameKeys(0.45, frame, "ease-out-cubic"),
      ];
    case "zoom":
      return [frameKeys("0%", frame, "linear"), frameKeys("100%", scaled(frame, 1.18), "linear")];
  }
}

/** Never let scene text open a JSON2Video `{{variable}}` placeholder. */
function plain(text: string): string {
  return text.replace(/\{\{|\}\}/g, "").trim();
}

/** Rough on-screen width of one character in a 66px bold Korean line (Hangul = 1). */
function glyphWidth(char: string): number {
  if (char === " ") return 0.35;
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ一-鿿]/.test(char)) return 1;
  if (/[A-Za-z0-9]/.test(char)) return 0.62;
  return 0.45;
}

const BUBBLE_LINE_UNITS = 12.5;

/**
 * JSON2Video wraps text at any character, which splits Korean words
 * ("올/렸죠"). Break at spaces ourselves; the text element honours "\n".
 */
export function wrapForBubble(text: string, maxUnits = BUBBLE_LINE_UNITS): string {
  const words = plain(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  let width = 0;
  for (const word of words) {
    const wordWidth = [...word].reduce((total, char) => total + glyphWidth(char), 0);
    if (line && width + glyphWidth(" ") + wordWidth > maxUnits) {
      lines.push(line);
      line = word;
      width = wordWidth;
    } else {
      line = line ? `${line} ${word}` : word;
      width = line === word ? wordWidth : width + glyphWidth(" ") + wordWidth;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function bubbleElement(text: string, speaker: VideoSpeaker): Record<string, unknown> {
  const colors = BUBBLES[speaker];
  return {
    type: "text",
    text: wrapForBubble(text),
    duration: -2,
    // The text box defaults to the full frame, vertically centred — pin it to the top so the
    // bubble never covers the character.
    position: "custom",
    x: "7%",
    y: 140,
    width: "86%",
    height: 520,
    "vertical-position": "top",
    "horizontal-position": "center",
    "fade-in": 0.15,
    settings: {
      "font-family": FONT_FAMILY,
      "font-size": "66px",
      "font-weight": "800",
      "line-height": "1.3",
      "text-align": "center",
      color: colors.color,
      "background-color": colors.background,
      padding: "44px 40px",
      "border-radius": "56px",
    },
  };
}

export function buildCharacterScene(scene: VideoRenderScene, index: number, fallbackImageUrl: string): Record<string, unknown> {
  const speaker: VideoSpeaker = scene.speaker ?? "main";
  const frame = baseFrame(speaker);
  const motion: VideoMotion = scene.motion ?? (speaker === "main" ? "pop" : "wobble");
  return {
    "background-color": SCENE_BACKGROUNDS[index % SCENE_BACKGROUNDS.length],
    transition: { type: "xfade", style: "fade", duration: 0.2 },
    elements: [
      {
        type: "voice",
        text: plain(scene.text),
        model: "azure",
        voice: VOICES[speaker],
        "extra-time": 0.35,
      },
      {
        type: "image",
        src: scene.imageUrl ?? fallbackImageUrl,
        duration: -2,
        position: "custom",
        resize: "contain",
        x: Math.round(frame.x),
        y: Math.round(frame.y),
        width: Math.round(frame.size),
        height: Math.round(frame.size),
        keyframes: motionKeyframes(motion, frame),
      },
      bubbleElement(scene.text, speaker),
    ],
  };
}

/** True when the render should use the reference-image (character) layout instead of the template. */
export function isCharacterRender(scenes: VideoRenderScene[]): boolean {
  return scenes.some((scene) => Boolean(scene.imageUrl));
}

export function buildCharacterMovie(scenes: VideoRenderScene[]): Record<string, unknown> {
  const fallbackImageUrl = scenes.find((scene) => scene.imageUrl)?.imageUrl;
  if (!fallbackImageUrl) throw new Error("캐릭터 영상에는 참고 이미지가 한 장 이상 필요합니다.");
  return {
    resolution: "custom",
    width: WIDTH,
    height: HEIGHT,
    quality: "high",
    scenes: scenes.map((scene, index) => buildCharacterScene(scene, index, fallbackImageUrl)),
    "client-data": { source: "autobiz-shorts-character", scene_count: scenes.length },
  };
}
