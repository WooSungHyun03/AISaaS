import "server-only";
import { serverEnv } from "@/lib/env/server";
import { classifyHttpStatus, ConnectorError } from "@/server/shared/errors";
import type { VideoRenderProvider, VideoRenderStatus } from "./types";

const API_BASE_URL = "https://api.json2video.com/v2";
const REQUEST_TIMEOUT_MS = 15_000;

interface Json2VideoOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
}

interface CreateMovieResponse {
  success?: boolean;
  project?: string;
}

interface MovieStatusResponse {
  success?: boolean;
  movie?: {
    status?: "pending" | "running" | "done" | "error" | "timeout";
    message?: string;
    url?: string | null;
    width?: number;
    height?: number;
  };
}

function safeUpstreamMessage(value: string | undefined): string {
  if (!value) return "상세 오류가 제공되지 않았습니다.";
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

function assertMp4PortraitUrl(movie: NonNullable<MovieStatusResponse["movie"]>): string {
  if (!movie.url) {
    throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", "JSON2Video가 완료된 MP4 URL을 반환하지 않았습니다.");
  }

  let parsed: URL;
  try {
    parsed = new URL(movie.url);
  } catch (cause) {
    throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", "JSON2Video가 올바르지 않은 결과 URL을 반환했습니다.", { cause });
  }
  if (parsed.protocol !== "https:" || !parsed.pathname.toLowerCase().endsWith(".mp4")) {
    throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", "JSON2Video 결과가 HTTPS MP4 파일이 아닙니다.");
  }
  if (!movie.width || !movie.height || movie.width * 16 !== movie.height * 9) {
    throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", "JSON2Video 결과가 9:16 세로 영상이 아닙니다.");
  }
  return parsed.toString();
}

export class Json2VideoRenderProvider implements VideoRenderProvider {
  readonly name = "json2video" as const;
  private readonly apiKey: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(options: Json2VideoOptions = {}) {
    this.apiKey = options.apiKey ?? serverEnv.VIDEO_RENDER_API_KEY;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private key(): string {
    if (!this.apiKey) {
      throw new ConnectorError("json2video", "NOT_CONFIGURED", "JSON2Video 렌더링 설정이 없습니다. VIDEO_RENDER_API_KEY를 확인해주세요.");
    }
    return this.apiKey;
  }

  private async fetchJson<T>(url: URL, init: RequestInit, fallbackMessage: string): Promise<T> {
    const apiKey = this.key();
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          ...init.headers,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
        throw new ConnectorError("json2video", "TIMEOUT", `${fallbackMessage} (요청 시간 초과)`, { cause });
      }
      throw new ConnectorError("json2video", "NETWORK_FAILURE", `${fallbackMessage} (연결 실패)`, { cause });
    }

    if (!response.ok) {
      throw new ConnectorError("json2video", classifyHttpStatus(response.status), `${fallbackMessage} (HTTP ${response.status})`);
    }
    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", `${fallbackMessage} (응답 형식 오류)`, { cause });
    }
  }

  /** Posts a full movie JSON and returns the project id; the render itself is polled with getMovieStatus. */
  async startMovie(movie: Record<string, unknown>): Promise<string> {
    const result = await this.fetchJson<CreateMovieResponse>(
      new URL(`${API_BASE_URL}/movies`),
      { method: "POST", body: JSON.stringify(movie) },
      "JSON2Video 렌더링을 시작하지 못했습니다.",
    );
    if (!result.success || !result.project) {
      throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", "JSON2Video가 렌더 작업 ID를 반환하지 않았습니다.");
    }
    return result.project;
  }

  async getMovieStatus(projectId: string): Promise<VideoRenderStatus> {
    const url = new URL(`${API_BASE_URL}/movies`);
    url.searchParams.set("project", projectId);
    url.searchParams.set("format", "simple");
    const result = await this.fetchJson<MovieStatusResponse>(url, {}, "JSON2Video 렌더링 상태를 확인하지 못했습니다.");
    const movie = result.movie;
    if (!result.success || !movie?.status) {
      throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", "JSON2Video가 렌더링 상태를 반환하지 않았습니다.");
    }
    if (movie.status === "done") return { state: "done", videoUrl: assertMp4PortraitUrl(movie) };
    if (movie.status === "error") return { state: "failed", message: `JSON2Video 렌더링에 실패했습니다: ${safeUpstreamMessage(movie.message)}` };
    if (movie.status === "timeout") return { state: "failed", message: `JSON2Video 렌더링 시간이 초과되었습니다: ${safeUpstreamMessage(movie.message)}` };
    if (movie.status !== "pending" && movie.status !== "running") {
      throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", `알 수 없는 JSON2Video 상태입니다: ${movie.status}`);
    }
    return { state: "pending" };
  }
}
