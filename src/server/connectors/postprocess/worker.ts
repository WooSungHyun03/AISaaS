import "server-only";
import { z } from "zod";
import { serverEnv } from "@/lib/env/server";
import { classifyHttpStatus, ConnectorError } from "@/server/shared/errors";
import {
  jobHandleSchema,
  mediaProbeSchema,
  videoAnalysisSchema,
  type ComposeSpec,
  type MediaProbe,
  type PostprocessJobHandle,
  type PostprocessJobStatus,
  type PostprocessProvider,
  type VideoAnalysis,
} from "./types";

const REQUEST_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 90_000;

const jobStatusSchema = z.object({ state: z.enum(["queued", "running", "done", "failed"]), result: z.unknown().optional(), error: z.string().optional() });

/** Client of worker/ffmpeg. The worker holds no state the app needs: a lost job is simply sent again. */
export class WorkerPostprocessProvider implements PostprocessProvider {
  readonly name = "worker" as const;
  private readonly baseUrl: string | undefined;
  private readonly token: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(options: { baseUrl?: string; token?: string; fetchFn?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl ?? serverEnv.POSTPROCESS_WORKER_URL)?.replace(/\/+$/, "");
    this.token = options.token ?? serverEnv.POSTPROCESS_WORKER_TOKEN;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async call(method: "GET" | "POST", path: string, body: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
    if (!this.baseUrl || !this.token) {
      throw new ConnectorError("postprocess", "NOT_CONFIGURED", "영상 후처리 서버 설정이 없습니다. POSTPROCESS_WORKER_URL과 POSTPROCESS_WORKER_TOKEN을 확인해주세요.");
    }
    try {
      return await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
        throw new ConnectorError("postprocess", "TIMEOUT", "영상 후처리 서버 응답이 늦어요.", { cause });
      }
      throw new ConnectorError("postprocess", "NETWORK_FAILURE", "영상 후처리 서버에 연결하지 못했어요.", { cause });
    }
  }

  private async failure(response: Response, what: string): Promise<ConnectorError> {
    const detail = ((await response.json().catch(() => null)) as { error?: string } | null)?.error;
    return new ConnectorError("postprocess", classifyHttpStatus(response.status), `${what} (HTTP ${response.status}${detail ? `: ${detail}` : ""})`);
  }

  async probe(url: string): Promise<MediaProbe> {
    const response = await this.call("POST", "/v1/probe", { url }, PROBE_TIMEOUT_MS);
    if (!response.ok) throw await this.failure(response, "파일 정보를 읽지 못했어요.");
    const parsed = mediaProbeSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new ConnectorError("postprocess", "UPSTREAM_SERVER_ERROR", "영상 후처리 서버가 올바르지 않은 파일 정보를 돌려줬어요.");
    return parsed.data;
  }

  private async start(body: Record<string, unknown>, what: string): Promise<PostprocessJobHandle> {
    const response = await this.call("POST", "/v1/jobs", body);
    if (!response.ok) throw await this.failure(response, what);
    const parsed = jobHandleSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new ConnectorError("postprocess", "UPSTREAM_SERVER_ERROR", "영상 후처리 서버가 작업 번호를 돌려주지 않았어요.");
    return parsed.data;
  }

  private async poll<T>(handle: PostprocessJobHandle, parse: (value: unknown) => T | null): Promise<PostprocessJobStatus<T>> {
    const response = await this.call("GET", `/v1/jobs/${encodeURIComponent(handle.jobId)}`, undefined);
    if (response.status === 404) return { state: "failed", message: "후처리 작업을 찾을 수 없어요.", lost: true };
    if (!response.ok) throw await this.failure(response, "후처리 상태를 확인하지 못했어요.");
    const status = jobStatusSchema.safeParse(await response.json().catch(() => null));
    if (!status.success) throw new ConnectorError("postprocess", "UPSTREAM_SERVER_ERROR", "영상 후처리 서버가 상태를 돌려주지 않았어요.");
    if (status.data.state === "queued" || status.data.state === "running") return { state: "pending" };
    if (status.data.state === "failed") return { state: "failed", message: status.data.error ?? "영상 후처리에 실패했어요." };
    const result = parse(status.data.result);
    return result ? { state: "done", result } : { state: "failed", message: "영상 후처리 결과를 읽지 못했어요." };
  }

  startAnalyze(videoUrl: string, frames: number) {
    return this.start({ type: "analyze", videoUrl, frames }, "영상 점검을 시작하지 못했어요.");
  }

  getAnalysis(handle: PostprocessJobHandle): Promise<PostprocessJobStatus<VideoAnalysis>> {
    return this.poll(handle, (value) => {
      const parsed = videoAnalysisSchema.safeParse(value);
      return parsed.success ? parsed.data : null;
    });
  }

  startCompose(spec: ComposeSpec) {
    return this.start(
      {
        type: "compose",
        videoUrl: spec.videoUrl,
        voiceUrl: spec.voiceUrl,
        audio: { mode: spec.audioMode, loudnorm: true },
        overlays: spec.overlays,
        target: spec.target,
        output: { uploadUrl: spec.uploadUrl },
      },
      "영상 마무리 작업을 시작하지 못했어요.",
    );
  }

  getCompose(handle: PostprocessJobHandle): Promise<PostprocessJobStatus<{ probe: MediaProbe }>> {
    return this.poll(handle, (value) => {
      const parsed = z.object({ probe: mediaProbeSchema }).safeParse(value);
      return parsed.success ? parsed.data : null;
    });
  }
}
