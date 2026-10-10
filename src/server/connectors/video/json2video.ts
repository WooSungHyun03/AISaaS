import "server-only";
import { serverEnv } from "@/lib/env/server";
import { classifyHttpStatus, ConnectorError } from "@/server/shared/errors";
import { buildCharacterMovie, isCharacterRender } from "./json2video-skit";
import type { VideoRenderProvider, VideoRenderScene } from "./types";

const API_BASE_URL = "https://api.json2video.com/v2";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 12;
const REQUEST_TIMEOUT_MS = 15_000;
const SCENE_BACKGROUND_COLORS = ["#0F172A", "#1E3A8A", "#312E81", "#4C1D95", "#701A75"];

interface Json2VideoOptions {
  apiKey?: string;
  templateId?: string;
  fetchFn?: typeof fetch;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  private readonly templateId: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;

  constructor(options: Json2VideoOptions = {}) {
    this.apiKey = options.apiKey ?? serverEnv.VIDEO_RENDER_API_KEY;
    this.templateId = options.templateId ?? serverEnv.VIDEO_RENDER_TEMPLATE_ID;
    this.fetchFn = options.fetchFn ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
  }

  /** The reference-image (character) layout is sent as a full movie, so it only needs the API key. */
  private credentials(options: { needsTemplate?: boolean } = { needsTemplate: true }): { apiKey: string; templateId: string } {
    const needsTemplate = options.needsTemplate !== false;
    if (!this.apiKey || (needsTemplate && !this.templateId)) {
      throw new ConnectorError(
        "json2video",
        "NOT_CONFIGURED",
        needsTemplate
          ? "JSON2Video 렌더링 설정이 없습니다. VIDEO_RENDER_API_KEY와 VIDEO_RENDER_TEMPLATE_ID를 확인해주세요."
          : "JSON2Video 렌더링 설정이 없습니다. VIDEO_RENDER_API_KEY를 확인해주세요.",
      );
    }
    return { apiKey: this.apiKey, templateId: this.templateId ?? "" };
  }

  private async fetchJson<T>(url: URL, init: RequestInit, fallbackMessage: string): Promise<T> {
    const { apiKey } = this.credentials({ needsTemplate: false });
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

  private async createRender(scenes: VideoRenderScene[], voiceScript: string): Promise<string> {
    const { templateId } = this.credentials();
    const payload = {
      template: templateId,
      resolution: "custom",
      width: 1080,
      height: 1920,
      variables: {
        voice_script: voiceScript,
        scene_items: scenes.map((scene, index) => ({
          scene_text: scene.text,
          visual_prompt: scene.visualPrompt,
          duration_sec: scene.durationSec,
          background_color: SCENE_BACKGROUND_COLORS[index % SCENE_BACKGROUND_COLORS.length],
        })),
      },
      "client-data": { source: "autobiz-shorts", scene_count: scenes.length },
    };
    const result = await this.fetchJson<CreateMovieResponse>(
      new URL(`${API_BASE_URL}/movies`),
      { method: "POST", body: JSON.stringify(payload) },
      "JSON2Video 렌더링을 시작하지 못했습니다.",
    );
    if (!result.success || !result.project) {
      throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", "JSON2Video가 렌더 작업 ID를 반환하지 않았습니다.");
    }
    return result.project;
  }

  private async createCharacterRender(scenes: VideoRenderScene[]): Promise<string> {
    this.credentials({ needsTemplate: false });
    const result = await this.fetchJson<CreateMovieResponse>(
      new URL(`${API_BASE_URL}/movies`),
      { method: "POST", body: JSON.stringify(buildCharacterMovie(scenes)) },
      "JSON2Video 렌더링을 시작하지 못했습니다.",
    );
    if (!result.success || !result.project) {
      throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", "JSON2Video가 렌더 작업 ID를 반환하지 않았습니다.");
    }
    return result.project;
  }

  private async waitForRender(projectId: string): Promise<string> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      const url = new URL(`${API_BASE_URL}/movies`);
      url.searchParams.set("project", projectId);
      url.searchParams.set("format", "simple");
      const result = await this.fetchJson<MovieStatusResponse>(url, {}, "JSON2Video 렌더링 상태를 확인하지 못했습니다.");
      const movie = result.movie;
      if (!result.success || !movie?.status) {
        throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", "JSON2Video가 렌더링 상태를 반환하지 않았습니다.");
      }

      if (movie.status === "done") return assertMp4PortraitUrl(movie);
      if (movie.status === "error") {
        throw new ConnectorError(
          "json2video",
          "UPSTREAM_SERVER_ERROR",
          `JSON2Video 렌더링에 실패했습니다: ${safeUpstreamMessage(movie.message)}`,
        );
      }
      if (movie.status === "timeout") {
        throw new ConnectorError("json2video", "TIMEOUT", `JSON2Video 렌더링 시간이 초과되었습니다: ${safeUpstreamMessage(movie.message)}`);
      }
      if (movie.status !== "pending" && movie.status !== "running") {
        throw new ConnectorError("json2video", "UPSTREAM_SERVER_ERROR", `알 수 없는 JSON2Video 상태입니다: ${movie.status}`);
      }
      if (attempt < this.maxPollAttempts - 1) await delay(this.pollIntervalMs);
    }
    throw new ConnectorError("json2video", "TIMEOUT", "JSON2Video 렌더링이 제한 시간 내에 완료되지 않았습니다.");
  }

  async renderShortVideo(scenes: VideoRenderScene[], voiceScript: string): Promise<string> {
    const projectId = isCharacterRender(scenes)
      ? await this.createCharacterRender(scenes)
      : await this.createRender(scenes, voiceScript);
    return this.waitForRender(projectId);
  }
}
