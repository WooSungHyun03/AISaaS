import "server-only";
import { serverEnv } from "@/lib/env/server";
import { Json2VideoRenderProvider } from "./json2video";
import { MockVideoRenderProvider } from "./mock";
import type { VideoRenderProvider } from "./types";

export type { VideoRenderProvider, VideoRenderScene, VideoRenderStatus } from "./types";
export { buildCharacterMovie } from "./json2video-skit";

export function getVideoRenderProvider(): VideoRenderProvider {
  return serverEnv.VIDEO_RENDER_PROVIDER === "json2video"
    ? new Json2VideoRenderProvider()
    : new MockVideoRenderProvider();
}

/** Starts a full-movie render and returns its project id without waiting (see getMovieRenderStatus). */
export async function startMovieRender(movie: Record<string, unknown>): Promise<string> {
  return getVideoRenderProvider().startMovie(movie);
}

export async function getMovieRenderStatus(projectId: string) {
  return getVideoRenderProvider().getMovieStatus(projectId);
}
