import { z } from "zod";
import type { WanResolution } from "@/server/budget/pricing";

/** Official limits of alibaba/wan-3.0/reference-to-video (https://fal.ai/models/alibaba/wan-3.0/reference-to-video/api). */
export const WAN_LIMITS = {
  maxImages: 10,
  maxVideos: 5,
  maxAudios: 5,
  /** Total seconds across all reference videos, and across all reference audio files. */
  maxVideoSeconds: 15,
  maxAudioSeconds: 15,
  minVideoFps: 16,
  minOutputSeconds: 20,
  maxOutputSeconds: 30,
  defaultOutputSeconds: 25,
} as const;

export interface WanRequest {
  /** English prompt built from the ad plan; refers to references by position ("image 1", "video 1"). */
  prompt: string;
  /** Output length in whole seconds (20-30). Always sent explicitly: the endpoint's own default is 5. */
  durationSec: number;
  /** Always sent explicitly: the endpoint's own default is 1080p, twice the price. */
  resolution: WanResolution;
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
  thinking: boolean;
  promptExpansion: boolean;
  seed?: number;
}

/** Opaque, JSON-serialisable pointer to a queued job; stored in the run's state so polling survives a restart. */
export const wanHandleSchema = z.object({
  requestId: z.string().min(1).max(200),
  statusUrl: z.string().url().max(1_000),
  responseUrl: z.string().url().max(1_000),
});
export type WanHandle = z.infer<typeof wanHandleSchema>;

export type WanStatus =
  | { state: "pending"; queuePosition?: number }
  | { state: "done"; videoUrl: string; durationSec?: number; width?: number; height?: number; seed?: number; actualPrompt?: string }
  | { state: "failed"; message: string };

export interface WanProvider {
  readonly name: "mock" | "fal";
  /** Queues one generation and returns immediately. The job may be billed from this moment on. */
  submit(request: WanRequest): Promise<WanHandle>;
  /** One quick status check; never waits for the video. */
  status(handle: WanHandle): Promise<WanStatus>;
}
