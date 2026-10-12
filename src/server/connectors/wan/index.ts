import "server-only";
import { serverEnv } from "@/lib/env/server";
import { FalWanProvider } from "./fal";
import { MockWanProvider } from "./mock";
import type { WanProvider } from "./types";

let cached: WanProvider | undefined;

export function getWanProvider(): WanProvider {
  cached ??= serverEnv.AD_VIDEO_PROVIDER === "fal" ? new FalWanProvider() : new MockWanProvider();
  return cached;
}

/** True when videos really are generated (paid). The mock produces placeholders only. */
export function isRealVideoGeneration(): boolean {
  return serverEnv.AD_VIDEO_PROVIDER === "fal";
}

export * from "./types";
export { buildWanInput } from "./fal";
