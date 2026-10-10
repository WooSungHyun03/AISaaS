import "server-only";
import { serverEnv } from "@/lib/env/server";
import { FalAnimationProvider } from "./fal";
import { MockAnimationProvider } from "./mock";
import type { AnimationProvider } from "./types";

export type { AnimationClipHandle, AnimationClipStatus, AnimationProvider } from "./types";
export { ANIMATION_CLIP_SECONDS } from "./types";

export function getAnimationProvider(): AnimationProvider {
  return serverEnv.ANIMATION_PROVIDER === "fal" ? new FalAnimationProvider() : new MockAnimationProvider();
}

/** True when real or mock animation can run; a half-configured `fal` (no key) counts as unavailable. */
export function isAnimationAvailable(): boolean {
  if (serverEnv.ANIMATION_PROVIDER === "fal") return Boolean(serverEnv.FAL_KEY);
  return true;
}
