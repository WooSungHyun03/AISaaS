import type { ComposeSpec, MediaProbe, PostprocessJobHandle, PostprocessJobStatus, PostprocessProvider, VideoAnalysis } from "./types";

const PROBE: MediaProbe = { durationSec: 25, sizeBytes: 4_000_000, formatName: "mov,mp4,m4a,3gp,3g2,mj2", hasVideo: true, hasAudio: true, width: 720, height: 1280, fps: 30, videoCodec: "h264", audioCodec: "aac" };

/** No worker needed: plausible measurements, so the whole pipeline can run locally and in CI. */
export class MockPostprocessProvider implements PostprocessProvider {
  readonly name = "mock" as const;
  readonly composed: ComposeSpec[] = [];

  async probe(url: string): Promise<MediaProbe> {
    const audioOnly = /\.(mp3|wav)(\?|$)/i.test(url);
    return { ...PROBE, durationSec: audioOnly ? 6 : /\.(mp4|mov)(\?|$)/i.test(url) ? 8 : 0, hasVideo: !audioOnly, width: audioOnly ? null : 720, height: audioOnly ? null : 1280, fps: audioOnly ? null : 30 };
  }

  async startAnalyze(): Promise<PostprocessJobHandle> {
    return { jobId: "mock-analyze" };
  }

  async getAnalysis(): Promise<PostprocessJobStatus<VideoAnalysis>> {
    return { state: "done", result: { probe: PROBE, black: { seconds: 0, spans: [] }, frozen: { seconds: 0, spans: [] }, audio: { meanVolumeDb: -20, maxVolumeDb: -3, silentSeconds: 0, silentRatio: 0, clippedSamples: 0 }, frames: [] } };
  }

  async startCompose(spec: ComposeSpec): Promise<PostprocessJobHandle> {
    this.composed.push(spec);
    return { jobId: "mock-compose" };
  }

  async getCompose(): Promise<PostprocessJobStatus<{ probe: MediaProbe }>> {
    return { state: "done", result: { probe: PROBE } };
  }
}
