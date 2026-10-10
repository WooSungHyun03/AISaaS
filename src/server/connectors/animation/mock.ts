import "server-only";
import type { AnimationClipHandle, AnimationClipRequest, AnimationClipStatus, AnimationProvider } from "./types";

/** Deterministic no-network animator used by local development and CI. */
export class MockAnimationProvider implements AnimationProvider {
  readonly name = "mock" as const;
  private counter = 0;

  async startClip(_request: AnimationClipRequest): Promise<AnimationClipHandle> {
    this.counter += 1;
    const id = `mock-clip-${Date.now()}-${this.counter}`;
    return { requestId: id, statusUrl: `https://animation.mock.invalid/status/${id}`, responseUrl: `https://animation.mock.invalid/result/${id}` };
  }

  async getClip(handle: AnimationClipHandle): Promise<AnimationClipStatus> {
    return { state: "done", videoUrl: `https://animation.mock.invalid/clips/${encodeURIComponent(handle.requestId)}.mp4` };
  }
}
