import "server-only";
import type { VideoRenderProvider, VideoRenderScene, VideoRenderStatus } from "./types";

const MOCK_VIDEO_URL = "https://video-render.mock.invalid/autobiz/shorts-preview.mp4";

/** Deterministic no-network renderer used by local development and CI. */
export class MockVideoRenderProvider implements VideoRenderProvider {
  readonly name = "mock" as const;

  async renderShortVideo(_scenes: VideoRenderScene[], _voiceScript: string): Promise<string> {
    return MOCK_VIDEO_URL;
  }

  async startMovie(_movie: Record<string, unknown>): Promise<string> {
    return "mock-project";
  }

  async getMovieStatus(_projectId: string): Promise<VideoRenderStatus> {
    return { state: "done", videoUrl: MOCK_VIDEO_URL };
  }
}
