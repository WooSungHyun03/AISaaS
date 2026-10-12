import type { WanHandle, WanProvider, WanRequest, WanStatus } from "./types";

/** No network, no cost: a placeholder address that is flagged as a sample everywhere it is shown. */
export class MockWanProvider implements WanProvider {
  readonly name = "mock" as const;
  readonly submitted: WanRequest[] = [];

  async submit(request: WanRequest): Promise<WanHandle> {
    this.submitted.push(request);
    const id = `mock-${this.submitted.length}-${request.durationSec}`;
    return { requestId: id, statusUrl: `https://wan-mock.invalid/${id}/status`, responseUrl: `https://wan-mock.invalid/${id}` };
  }

  async status(handle: WanHandle): Promise<WanStatus> {
    const seconds = Number(handle.requestId.split("-").at(-1)) || 25;
    return { state: "done", videoUrl: `https://wan-mock.invalid/${handle.requestId}.mp4`, durationSec: seconds, width: 720, height: 1280, seed: 1 };
  }
}
