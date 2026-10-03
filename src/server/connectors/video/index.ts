import "server-only";
import { serverEnv } from "@/lib/env/server";
import { ConnectorError } from "@/server/shared/errors";
import { Json2VideoRenderProvider } from "./json2video";
import { MockVideoRenderProvider } from "./mock";
import { videoRenderInputSchema, type VideoRenderProvider, type VideoRenderScene } from "./types";

export type { VideoRenderProvider, VideoRenderScene } from "./types";

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
