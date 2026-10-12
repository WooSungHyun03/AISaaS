import "server-only";
import { serverEnv } from "@/lib/env/server";
import { classifyHttpStatus, ConnectorError } from "@/server/shared/errors";
import { WAN_LIMITS, type WanHandle, type WanProvider, type WanRequest, type WanStatus } from "./types";

const QUEUE_BASE = "https://queue.fal.run/";
const REQUEST_TIMEOUT_MS = 20_000;
/** The handle is stored in our database; only ever follow URLs that stay on fal's queue host. */
const TRUSTED_URL_PREFIX = QUEUE_BASE;

/**
 * The exact request body of Wan 3.0 reference-to-video. Everything that changes the price or the shape is sent
 * explicitly — resolution (the endpoint defaults to 1080p), duration (defaults to 5), aspect ratio (defaults to
 * "adaptive") — and the request is refused here, before any money is reserved, when it breaks an official limit.
 */
export function buildWanInput(request: WanRequest): Record<string, unknown> {
  if (!Number.isInteger(request.durationSec) || request.durationSec < WAN_LIMITS.minOutputSeconds || request.durationSec > WAN_LIMITS.maxOutputSeconds) {
    throw new ConnectorError("fal", "INVALID_TARGET", `영상 길이는 ${WAN_LIMITS.minOutputSeconds}~${WAN_LIMITS.maxOutputSeconds}초 사이의 정수여야 합니다.`);
  }
  if (request.imageUrls.length > WAN_LIMITS.maxImages) throw new ConnectorError("fal", "INVALID_TARGET", `참고 이미지는 최대 ${WAN_LIMITS.maxImages}장입니다.`);
  if (request.videoUrls.length > WAN_LIMITS.maxVideos) throw new ConnectorError("fal", "INVALID_TARGET", `참고 영상은 최대 ${WAN_LIMITS.maxVideos}개입니다.`);
  if (request.audioUrls.length > WAN_LIMITS.maxAudios) throw new ConnectorError("fal", "INVALID_TARGET", `참고 음원은 최대 ${WAN_LIMITS.maxAudios}개입니다.`);
  for (const url of [...request.imageUrls, ...request.videoUrls, ...request.audioUrls]) {
    if (!/^https:\/\//i.test(url)) throw new ConnectorError("fal", "INVALID_TARGET", "참고 파일 주소는 HTTPS여야 합니다.");
  }
  return {
    prompt: request.prompt,
    resolution: request.resolution,
    aspect_ratio: "9:16",
    duration: request.durationSec,
    audio: true,
    enable_prompt_expansion: request.promptExpansion,
    enable_thinking: request.thinking,
    enable_safety_checker: true,
    ...(request.imageUrls.length > 0 ? { reference_image_urls: request.imageUrls } : {}),
    ...(request.videoUrls.length > 0 ? { reference_video_urls: request.videoUrls } : {}),
    ...(request.audioUrls.length > 0 ? { reference_audio_urls: request.audioUrls } : {}),
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
  };
}

interface FalSubmitResponse { request_id?: string; status_url?: string; response_url?: string }
interface FalStatusResponse { status?: string; queue_position?: number; error?: string; detail?: unknown }
interface FalResultResponse {
  video?: { url?: string; width?: number; height?: number; duration?: number };
  duration?: number;
  seed?: number;
  actual_prompt?: string;
  detail?: unknown;
  error?: string;
}

function describeFailure(body: { detail?: unknown; error?: string } | null, fallback: string): string {
  const raw = typeof body?.error === "string" ? body.error : typeof body?.detail === "string" ? body.detail : Array.isArray(body?.detail) ? JSON.stringify(body?.detail) : "";
  return (raw || fallback).replace(/\s+/g, " ").trim().slice(0, 300);
}

/** fal.ai queue API for Wan 3.0 Standard reference-to-video. https://fal.ai/docs/documentation/model-apis/inference/queue */
export class FalWanProvider implements WanProvider {
  readonly name = "fal" as const;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: { apiKey?: string; model?: string; fetchFn?: typeof fetch } = {}) {
    this.apiKey = options.apiKey ?? serverEnv.FAL_KEY;
    this.model = (options.model ?? serverEnv.WAN_MODEL).replace(/^\/+|\/+$/g, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async request(url: string, init: RequestInit, failure: string): Promise<Response> {
    if (!url.startsWith(TRUSTED_URL_PREFIX)) {
      throw new ConnectorError("fal", "INVALID_TARGET", "영상 생성 서비스가 올바르지 않은 주소를 반환했습니다.");
    }
    if (!this.apiKey) throw new ConnectorError("fal", "NOT_CONFIGURED", "영상 생성 서비스 설정이 없습니다. FAL_KEY를 확인해주세요.");
    try {
      return await this.fetchFn(url, {
        ...init,
        headers: { Authorization: `Key ${this.apiKey}`, "Content-Type": "application/json", ...init.headers },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
        throw new ConnectorError("fal", "TIMEOUT", `${failure} (요청 시간 초과)`, { cause });
      }
      throw new ConnectorError("fal", "NETWORK_FAILURE", `${failure} (연결 실패)`, { cause });
    }
  }

  async submit(request: WanRequest): Promise<WanHandle> {
    const body = buildWanInput(request);
    const response = await this.request(`${QUEUE_BASE}${this.model}`, { method: "POST", body: JSON.stringify(body) }, "영상 생성을 시작하지 못했습니다.");
    if (!response.ok) {
      const detail = describeFailure((await response.json().catch(() => null)) as { detail?: unknown; error?: string } | null, "");
      throw new ConnectorError("fal", classifyHttpStatus(response.status), `영상 생성을 시작하지 못했습니다. (HTTP ${response.status}${detail ? `: ${detail}` : ""})`);
    }
    const parsed = (await response.json().catch(() => null)) as FalSubmitResponse | null;
    if (!parsed?.request_id || !parsed.status_url || !parsed.response_url) {
      throw new ConnectorError("fal", "UPSTREAM_SERVER_ERROR", "영상 생성 서비스가 작업 번호를 반환하지 않았습니다.");
    }
    return { requestId: parsed.request_id, statusUrl: parsed.status_url, responseUrl: parsed.response_url };
  }

  async status(handle: WanHandle): Promise<WanStatus> {
    const statusResponse = await this.request(handle.statusUrl, { method: "GET" }, "영상 생성 상태를 확인하지 못했습니다.");
    if (!statusResponse.ok) {
      throw new ConnectorError("fal", classifyHttpStatus(statusResponse.status), `영상 생성 상태를 확인하지 못했습니다. (HTTP ${statusResponse.status})`);
    }
    const status = (await statusResponse.json().catch(() => null)) as FalStatusResponse | null;
    if (!status?.status) throw new ConnectorError("fal", "UPSTREAM_SERVER_ERROR", "영상 생성 서비스가 상태를 반환하지 않았습니다.");
    if (status.status === "IN_QUEUE" || status.status === "IN_PROGRESS") return { state: "pending", ...(status.queue_position !== undefined ? { queuePosition: status.queue_position } : {}) };
    if (status.status !== "COMPLETED") return { state: "failed", message: describeFailure(status, `알 수 없는 상태입니다: ${status.status}`) };
    if (status.error) return { state: "failed", message: describeFailure(status, "영상 생성에 실패했습니다.") };

    const resultResponse = await this.request(handle.responseUrl, { method: "GET" }, "영상 생성 결과를 가져오지 못했습니다.");
    const result = (await resultResponse.json().catch(() => null)) as FalResultResponse | null;
    if (!resultResponse.ok) return { state: "failed", message: describeFailure(result, `영상 생성에 실패했습니다. (HTTP ${resultResponse.status})`) };
    const videoUrl = result?.video?.url;
    if (!videoUrl || !/^https:\/\//i.test(videoUrl)) return { state: "failed", message: "영상 생성 서비스가 영상 주소를 반환하지 않았습니다." };
    return {
      state: "done",
      videoUrl,
      durationSec: result?.duration ?? result?.video?.duration,
      width: result?.video?.width,
      height: result?.video?.height,
      seed: result?.seed,
      actualPrompt: result?.actual_prompt,
    };
  }
}
