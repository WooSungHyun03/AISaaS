import "server-only";
import { serverEnv } from "@/lib/env/server";
import { ElevenLabsTtsProvider } from "./elevenlabs";
import { MockTtsProvider } from "./mock";
import type { TtsProvider } from "./types";

let cached: TtsProvider | undefined;

export function getTtsProvider(): TtsProvider {
  cached ??= serverEnv.TTS_PROVIDER === "elevenlabs" ? new ElevenLabsTtsProvider() : new MockTtsProvider();
  return cached;
}

export * from "./types";
