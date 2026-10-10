import "server-only";
import { serverEnv } from "@/lib/env/server";
import { classifyHttpStatus, ConnectorError } from "@/server/shared/errors";
import {
  ANIMATION_CLIP_SECONDS,
  type AnimationClipHandle,
  type AnimationClipRequest,
  type AnimationClipStatus,
  type AnimationProvider,
} from "./types";

/**
 * fal.ai queue API (one key, many image-to-video models). Default model is
 * Kling 2.5 Turbo Pro; set ANIMATION_MODEL to switch (the body below is the
 * common `image_url` + `prompt` shape plus `duration`).
 *
 * https://fal.ai/docs/documentation/model-apis/inference/queue
 */
export const DEFAULT_ANIMATION_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/image-to-video";
const QUEUE_BASE = "https://queue.fal.run/";
const REQUEST_TIMEOUT_MS = 15_000;
/** The handle is stored in our database; only ever follow URLs that stay on fal's queue host. */
const TRUSTED_URL_PREFIX = QUEUE_BASE;

interface FalOptions {
  apiKey?: string;
  model?: string;
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
  detail?: unknown;
  error?: string;
}

function describeFailure(body: { detail?: unknown; error?: string } | null, fallback: string): string {
  const raw = typeof body?.error === "string" ? body.error : typeof body?.detail === "string" ? body.detail : Array.isArray(body?.detail) ? JSON.stringify(body?.detail) : "";
  return (raw || fallback).replace(/\s+/g, " ").trim().slice(0, 300);
}

export class FalAnimationProvider implements AnimationProvider {
  readonly name = "fal" as const;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: FalOptions = {}) {
    this.apiKey = options.apiKey ?? serverEnv.FAL_KEY;
    this.model = (options.model ?? serverEnv.ANIMATION_MODEL ?? DEFAULT_ANIMATION_MODEL).replace(/^\/+|\/+$/g, "");
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

  async startClip(request: AnimationClipRequest): Promise<AnimationClipHandle> {
    const response = await this.request(
      `${QUEUE_BASE}${this.model}`,
      {
        method: "POST",
        body: JSON.stringify({
          image_url: request.imageUrl,
          prompt: request.prompt,
          duration: String(ANIMATION_CLIP_SECONDS),
        }),
      },
      "캐릭터 움직임 생성을 시작하지 못했습니다.",
    );
    if (!response.ok) {
      throw new ConnectorError("fal", classifyHttpStatus(response.status), `캐릭터 움직임 생성을 시작하지 못했습니다. (HTTP ${response.status})`);
    }
    const body = (await response.json().catch(() => null)) as FalSubmitResponse | null;
    if (!body?.request_id || !body.status_url || !body.response_url) {
      throw new ConnectorError("fal", "UPSTREAM_SERVER_ERROR", "움직임 생성 서비스가 작업 번호를 반환하지 않았습니다.");
    }
    return { requestId: body.request_id, statusUrl: body.status_url, responseUrl: body.response_url };
  }

  async getClip(handle: AnimationClipHandle): Promise<AnimationClipStatus> {
    const statusResponse = await this.request(handle.statusUrl, { method: "GET" }, "캐릭터 움직임 상태를 확인하지 못했습니다.");
    if (!statusResponse.ok) {
      throw new ConnectorError("fal", classifyHttpStatus(statusResponse.status), `캐릭터 움직임 상태를 확인하지 못했습니다. (HTTP ${statusResponse.status})`);
    }
    const status = (await statusResponse.json().catch(() => null)) as FalStatusResponse | null;
    if (!status?.status) {
      throw new ConnectorError("fal", "UPSTREAM_SERVER_ERROR", "움직임 생성 서비스가 상태를 반환하지 않았습니다.");
    }
    if (status.status === "IN_QUEUE" || status.status === "IN_PROGRESS") return { state: "pending" };
    if (status.status !== "COMPLETED") {
      return { state: "failed", message: describeFailure(status, `알 수 없는 상태입니다: ${status.status}`) };
    }
    if (status.error) return { state: "failed", message: describeFailure(status, "움직임 생성에 실패했습니다.") };

    const resultResponse = await this.request(handle.responseUrl, { method: "GET" }, "캐릭터 움직임 결과를 가져오지 못했습니다.");
    const result = (await resultResponse.json().catch(() => null)) as FalResultResponse | null;
    if (!resultResponse.ok) {
      return { state: "failed", message: describeFailure(result, `움직임 생성에 실패했습니다. (HTTP ${resultResponse.status})`) };
    }
    const videoUrl = result?.video?.url;
    if (!videoUrl || !/^https:\/\//i.test(videoUrl)) {
      return { state: "failed", message: "움직임 생성 서비스가 영상 주소를 반환하지 않았습니다." };
    }
    return { state: "done", videoUrl };
  }
}
