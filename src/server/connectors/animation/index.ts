import "server-only";
import { serverEnv } from "@/lib/env/server";
import { FalAnimationProvider } from "./fal";
import { MockAnimationProvider } from "./mock";
import type { AnimationProvider } from "./types";

export type { AnimationClipHandle, AnimationClipStatus, AnimationProvider, AnimationQuality, MusicStatus } from "./types";
export { ANIMATION_CLIP_SECONDS } from "./types";

export function getAnimationProvider(): AnimationProvider {
  return serverEnv.ANIMATION_PROVIDER === "fal" ? new FalAnimationProvider() : new MockAnimationProvider();
}

/**
 * True when clips (and music) can really be made. A half-configured `fal` (no key) is unavailable. The mock
 * only counts as available next to the mock renderer: its fake clip URLs would make a real JSON2Video render
 * fail, so with a real renderer and no animation service the video falls back to the simple motion effect.
 */
export function isAnimationAvailable(): boolean {
  if (serverEnv.ANIMATION_PROVIDER === "fal") return Boolean(serverEnv.FAL_KEY);
  return serverEnv.VIDEO_RENDER_PROVIDER !== "json2video";
}
