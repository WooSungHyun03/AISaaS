import "server-only";
import { serverEnv } from "@/lib/env/server";
import { Json2VideoRenderProvider } from "./json2video";
import { MockVideoRenderProvider } from "./mock";
import type { VideoRenderProvider } from "./types";

export type { VideoRenderProvider, VideoRenderScene, VideoRenderStatus } from "./types";
export { buildCharacterMovie } from "./json2video-skit";
export { buildPromoMovie, type PromoEndCard, type PromoRenderScene } from "./json2video-promo";

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

/** Volume of the background track relative to the voice (JSON2Video has no auto-ducking; 0.2 is its recommended level under narration). */
export const BACKGROUND_MUSIC_VOLUME = 0.2;

/** Adds one instrumental track under the whole movie: looped to the movie length with a short fade-out. */
export function withBackgroundMusic(movie: Record<string, unknown>, audioUrl: string): Record<string, unknown> {
  const existing = Array.isArray(movie.elements) ? (movie.elements as unknown[]) : [];
  return {
    ...movie,
    elements: [...existing, { type: "audio", src: audioUrl, volume: BACKGROUND_MUSIC_VOLUME, loop: -1, duration: -2, "fade-in": 0.5, "fade-out": 1.5 }],
  };
}
