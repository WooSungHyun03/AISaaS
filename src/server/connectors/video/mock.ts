import "server-only";
import type { VideoRenderProvider, VideoRenderScene } from "./types";

/** Deterministic no-network renderer used by local development and CI. */
export class MockVideoRenderProvider implements VideoRenderProvider {
  readonly name = "mock" as const;

  async renderShortVideo(_scenes: VideoRenderScene[], _voiceScript: string): Promise<string> {
    return "https://video-render.mock.invalid/autobiz/shorts-preview.mp4";
  }
}
