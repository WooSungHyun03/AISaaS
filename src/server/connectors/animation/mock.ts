import "server-only";
import type {
  AnimationClipHandle,
  AnimationClipOptions,
  AnimationClipRequest,
  AnimationClipStatus,
  AnimationProvider,
  MusicRequest,
  MusicStatus,
} from "./types";

/** Deterministic no-network animator used by local development and CI. */
export class MockAnimationProvider implements AnimationProvider {
  readonly name = "mock" as const;
  private counter = 0;

  private handle(kind: string): AnimationClipHandle {
    this.counter += 1;
    const id = `mock-${kind}-${Date.now()}-${this.counter}`;
    return { requestId: id, statusUrl: `https://animation.mock.invalid/status/${id}`, responseUrl: `https://animation.mock.invalid/result/${id}` };
  }

  async startClip(_request: AnimationClipRequest, _options?: AnimationClipOptions): Promise<AnimationClipHandle> {
    return this.handle("clip");
  }

  async getClip(handle: AnimationClipHandle): Promise<AnimationClipStatus> {
    return { state: "done", videoUrl: `https://animation.mock.invalid/clips/${encodeURIComponent(handle.requestId)}.mp4` };
  }

  async startMusic(_request: MusicRequest): Promise<AnimationClipHandle> {
    return this.handle("music");
  }

  async getMusic(handle: AnimationClipHandle): Promise<MusicStatus> {
    return { state: "done", audioUrl: `https://animation.mock.invalid/music/${encodeURIComponent(handle.requestId)}.mp3` };
  }
}
