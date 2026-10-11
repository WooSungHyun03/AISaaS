import "server-only";
import { serverEnv } from "@/lib/env/server";
import { classifyHttpStatus, ConnectorError } from "@/server/shared/errors";
import {
  ANIMATION_CLIP_SECONDS,
  type AnimationClipHandle,
  type AnimationClipOptions,
  type AnimationClipRequest,
  type AnimationClipStatus,
  type AnimationProvider,
  type MusicRequest,
  type MusicStatus,
} from "./types";

/**
 * fal.ai queue API (one key, many models). Image-to-video defaults to Kling 2.5 Turbo Pro
 * (ANIMATION_MODEL) with Kling 3.0 Pro for premium plans (ANIMATION_MODEL_PREMIUM); background
 * music defaults to Lyria 2 (MUSIC_MODEL). Each model family takes slightly different input names,
 * mapped in `clipBody` / `musicBody`.
 *
 * https://fal.ai/docs/documentation/model-apis/inference/queue
 */
export const DEFAULT_ANIMATION_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
export const DEFAULT_PREMIUM_ANIMATION_MODEL = "fal-ai/kling-video/v3/pro/image-to-video";
export const DEFAULT_MUSIC_MODEL = "fal-ai/lyria2";
const QUEUE_BASE = "https://queue.fal.run/";
const REQUEST_TIMEOUT_MS = 15_000;
/** The handle is stored in our database; only ever follow URLs that stay on fal's queue host. */
const TRUSTED_URL_PREFIX = QUEUE_BASE;

interface FalOptions {
  apiKey?: string;
  model?: string;
  premiumModel?: string;
  musicModel?: string;
  fetchFn?: typeof fetch;
}

interface FalSubmitResponse {
  request_id?: string;
  status_url?: string;
  response_url?: string;
}

interface FalStatusResponse {
  status?: string;
  error?: string;
  detail?: unknown;
}

interface FalResultResponse {
  video?: { url?: string };
  audio?: { url?: string };
  detail?: unknown;
  error?: string;
}

function describeFailure(body: { detail?: unknown; error?: string } | null, fallback: string): string {
  const raw = typeof body?.error === "string" ? body.error : typeof body?.detail === "string" ? body.detail : Array.isArray(body?.detail) ? JSON.stringify(body?.detail) : "";
  return (raw || fallback).replace(/\s+/g, " ").trim().slice(0, 300);
}

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, "");

/** Input names differ between model families: Kling 3 takes `start_image_url`, earlier models `image_url`. */
export function clipBody(model: string, request: AnimationClipRequest): Record<string, unknown> {
  const common = { prompt: request.prompt, duration: String(ANIMATION_CLIP_SECONDS) };
  if (/\/v3\//.test(model)) return { ...common, start_image_url: request.imageUrl, generate_audio: false };
  return { ...common, image_url: request.imageUrl };
}

export function musicBody(model: string, request: MusicRequest): Record<string, unknown> {
  if (model.includes("minimax-music")) return { prompt: request.prompt, is_instrumental: true };
  return { prompt: request.prompt, negative_prompt: "vocals, singing, lyrics, speech, voice, spoken words" };
}

export class FalAnimationProvider implements AnimationProvider {
  readonly name = "fal" as const;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly premiumModel: string;
  private readonly musicModel: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: FalOptions = {}) {
    this.apiKey = options.apiKey ?? serverEnv.FAL_KEY;
    this.model = trimSlashes(options.model ?? serverEnv.ANIMATION_MODEL ?? DEFAULT_ANIMATION_MODEL);
    this.premiumModel = trimSlashes(options.premiumModel ?? serverEnv.ANIMATION_MODEL_PREMIUM ?? DEFAULT_PREMIUM_ANIMATION_MODEL);
    this.musicModel = trimSlashes(options.musicModel ?? serverEnv.MUSIC_MODEL ?? DEFAULT_MUSIC_MODEL);
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private key(): string {
    if (!this.apiKey) {
      throw new ConnectorError("fal", "NOT_CONFIGURED", "움직이는 영상 서비스 설정이 없습니다. FAL_KEY를 확인해주세요.");
    }
    return this.apiKey;
  }

  private async request(url: string, init: RequestInit, fallbackMessage: string): Promise<Response> {
    if (!url.startsWith(TRUSTED_URL_PREFIX)) {
      throw new ConnectorError("fal", "INVALID_TARGET", "움직이는 영상 서비스가 올바르지 않은 주소를 반환했습니다.");
    }
    const apiKey = this.key();
    try {
      return await this.fetchFn(url, {
        ...init,
        headers: { Authorization: `Key ${apiKey}`, "Content-Type": "application/json", ...init.headers },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
        throw new ConnectorError("fal", "TIMEOUT", `${fallbackMessage} (요청 시간 초과)`, { cause });
      }
      throw new ConnectorError("fal", "NETWORK_FAILURE", `${fallbackMessage} (연결 실패)`, { cause });
    }
  }

  private async submit(model: string, body: Record<string, unknown>, failureMessage: string): Promise<AnimationClipHandle> {
    const response = await this.request(`${QUEUE_BASE}${model}`, { method: "POST", body: JSON.stringify(body) }, failureMessage);
    if (!response.ok) {
      throw new ConnectorError("fal", classifyHttpStatus(response.status), `${failureMessage} (HTTP ${response.status})`);
    }
    const parsed = (await response.json().catch(() => null)) as FalSubmitResponse | null;
    if (!parsed?.request_id || !parsed.status_url || !parsed.response_url) {
      throw new ConnectorError("fal", "UPSTREAM_SERVER_ERROR", "AI 생성 서비스가 작업 번호를 반환하지 않았습니다.");
    }
    return { requestId: parsed.request_id, statusUrl: parsed.status_url, responseUrl: parsed.response_url };
  }

  async startClip(request: AnimationClipRequest, options: AnimationClipOptions = {}): Promise<AnimationClipHandle> {
    const model = options.quality === "premium" ? this.premiumModel : this.model;
    return this.submit(model, clipBody(model, request), "캐릭터 움직임 생성을 시작하지 못했습니다.");
  }

  async startMusic(request: MusicRequest): Promise<AnimationClipHandle> {
    return this.submit(this.musicModel, musicBody(this.musicModel, request), "배경음악 생성을 시작하지 못했습니다.");
  }

  /** Shared queue polling: pending, failed with a reason, or the finished result body. */
  private async poll(handle: AnimationClipHandle, noun: string): Promise<{ state: "pending" } | { state: "failed"; message: string } | { state: "done"; result: FalResultResponse }> {
    const statusResponse = await this.request(handle.statusUrl, { method: "GET" }, `${noun} 상태를 확인하지 못했습니다.`);
    if (!statusResponse.ok) {
      throw new ConnectorError("fal", classifyHttpStatus(statusResponse.status), `${noun} 상태를 확인하지 못했습니다. (HTTP ${statusResponse.status})`);
    }
    const status = (await statusResponse.json().catch(() => null)) as FalStatusResponse | null;
    if (!status?.status) {
      throw new ConnectorError("fal", "UPSTREAM_SERVER_ERROR", "AI 생성 서비스가 상태를 반환하지 않았습니다.");
    }
    if (status.status === "IN_QUEUE" || status.status === "IN_PROGRESS") return { state: "pending" };
    if (status.status !== "COMPLETED") return { state: "failed", message: describeFailure(status, `알 수 없는 상태입니다: ${status.status}`) };
    if (status.error) return { state: "failed", message: describeFailure(status, `${noun}에 실패했습니다.`) };

    const resultResponse = await this.request(handle.responseUrl, { method: "GET" }, `${noun} 결과를 가져오지 못했습니다.`);
    const result = (await resultResponse.json().catch(() => null)) as FalResultResponse | null;
    if (!resultResponse.ok) return { state: "failed", message: describeFailure(result, `${noun}에 실패했습니다. (HTTP ${resultResponse.status})`) };
    return { state: "done", result: result ?? {} };
  }

  async getMusic(handle: AnimationClipHandle): Promise<MusicStatus> {
    const polled = await this.poll(handle, "배경음악");
    if (polled.state !== "done") return polled;
    const audioUrl = polled.result.audio?.url;
    if (!audioUrl || !/^https:\/\//i.test(audioUrl)) return { state: "failed", message: "배경음악 주소를 받지 못했습니다." };
    return { state: "done", audioUrl };
  }

  async getClip(handle: AnimationClipHandle): Promise<AnimationClipStatus> {
    const polled = await this.poll(handle, "캐릭터 움직임");
    if (polled.state !== "done") return polled;
    const videoUrl = polled.result.video?.url;
    if (!videoUrl || !/^https:\/\//i.test(videoUrl)) {
      return { state: "failed", message: "움직임 생성 서비스가 영상 주소를 반환하지 않았습니다." };
    }
    return { state: "done", videoUrl };
  }
}
