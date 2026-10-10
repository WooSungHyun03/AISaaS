import "server-only";
import { serverEnv } from "@/lib/env/server";
import { ConnectorError } from "@/server/shared/errors";
import { Json2VideoRenderProvider } from "./json2video";
import { MockVideoRenderProvider } from "./mock";
import { videoRenderInputSchema, type VideoRenderProvider, type VideoRenderScene } from "./types";

export type { VideoRenderProvider, VideoRenderScene, VideoRenderStatus } from "./types";
export { buildCharacterMovie } from "./json2video-skit";
export { buildShowcaseMovie, type ShowcaseScene } from "./json2video-showcase";

export function getVideoRenderProvider(): VideoRenderProvider {
  return serverEnv.VIDEO_RENDER_PROVIDER === "json2video"
    ? new Json2VideoRenderProvider()
    : new MockVideoRenderProvider();
}

export async function renderShortVideo(scenes: VideoRenderScene[], voiceScript: string): Promise<string> {
  const parsed = videoRenderInputSchema.safeParse({ scenes, voiceScript });
  if (!parsed.success) {
    throw new ConnectorError("video-render", "INVALID_TARGET", "Shorts 렌더링 입력이 올바르지 않습니다.", {
      cause: parsed.error,
    });
  }
  return getVideoRenderProvider().renderShortVideo(parsed.data.scenes, parsed.data.voiceScript);
}

/** Starts a full-movie render and returns its project id without waiting (see getMovieRenderStatus). */
export async function startMovieRender(movie: Record<string, unknown>): Promise<string> {
  return getVideoRenderProvider().startMovie(movie);
}

export async function getMovieRenderStatus(projectId: string) {
  return getVideoRenderProvider().getMovieStatus(projectId);
}
