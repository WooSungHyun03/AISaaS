import "server-only";
import { serverEnv } from "@/lib/env/server";
import { classifyHttpStatus, ConnectorError } from "@/server/shared/errors";
import type { PlatformConnector, PublishContentParams, PublishResult } from "../types";
import { refreshYouTubeAccessToken } from "./oauth";

const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const VIDEO_DOWNLOAD_TIMEOUT_MS = 60_000;
const GOOGLE_REQUEST_TIMEOUT_MS = 120_000;
const MAX_SHORTS_BYTES = 200 * 1024 * 1024;

export interface YouTubeConnection {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface YouTubeConnectorOptions {
  fetchFn?: typeof fetch;
}

interface YouTubeUploadResponse {
  id?: string;
  status?: { privacyStatus?: string };
}

function videoTarget(value: string | undefined): URL {
  if (!value) throw new ConnectorError("youtube", "INVALID_TARGET", "YouTube Shorts 업로드에는 영상 URL이 필요합니다.");
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new ConnectorError("youtube", "INVALID_TARGET", "YouTube Shorts 영상 URL이 올바르지 않습니다.", { cause });
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.pathname.toLowerCase().endsWith(".mp4")) {
    throw new ConnectorError("youtube", "INVALID_TARGET", "공개 HTTPS MP4 영상 URL이 필요합니다.");
  }
  return url;
}

function safeTitle(value: string | undefined): string {
  return value?.trim().slice(0, 100) || "AutoBiz Shorts";
}

/** YouTube Data API connector. Every upload is deliberately private. */
export class YouTubeConnector implements PlatformConnector {
  readonly name = "youtube";
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly connection?: YouTubeConnection,
    options: YouTubeConnectorOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  isConfigured(): boolean {
    if (this.connection) return Boolean(this.connection.clientId && this.connection.clientSecret && this.connection.refreshToken);
    return Boolean(serverEnv.YOUTUBE_CLIENT_ID && serverEnv.YOUTUBE_CLIENT_SECRET && serverEnv.YOUTUBE_REFRESH_TOKEN);
  }

  private credentials(): YouTubeConnection {
    if (this.connection) return this.connection;
    if (!this.isConfigured()) throw new ConnectorError("youtube", "NOT_CONFIGURED", "YouTube 연결이 설정되지 않았습니다.");
    return {
      clientId: serverEnv.YOUTUBE_CLIENT_ID!,
      clientSecret: serverEnv.YOUTUBE_CLIENT_SECRET!,
      refreshToken: serverEnv.YOUTUBE_REFRESH_TOKEN!,
    };
  }

  private async request(input: string | URL, init: RequestInit, fallback: string, timeoutMs = GOOGLE_REQUEST_TIMEOUT_MS): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(input, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
        throw new ConnectorError("youtube", "TIMEOUT", `${fallback} (요청 시간 초과)`, { cause });
      }
      throw new ConnectorError("youtube", "NETWORK_FAILURE", `${fallback} (연결 실패)`, { cause });
    }
    if (!response.ok) {
      throw new ConnectorError("youtube", classifyHttpStatus(response.status), `${fallback} (HTTP ${response.status})`);
    }
    return response;
  }

  private async downloadVideo(url: URL): Promise<ArrayBuffer> {
    const response = await this.request(url, {}, "렌더링된 Shorts 영상을 불러오지 못했습니다.", VIDEO_DOWNLOAD_TIMEOUT_MS);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "video/mp4" && contentType !== "application/octet-stream") {
      throw new ConnectorError("youtube", "INVALID_TARGET", "업로드할 파일이 MP4 영상이 아닙니다.");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SHORTS_BYTES) {
      throw new ConnectorError("youtube", "INVALID_TARGET", "Shorts 영상 파일은 200MB 이하여야 합니다.");
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch (cause) {
      throw new ConnectorError("youtube", "NETWORK_FAILURE", "Shorts 영상 파일을 읽지 못했습니다.", { cause });
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_SHORTS_BYTES) {
      throw new ConnectorError("youtube", "INVALID_TARGET", "Shorts 영상 파일 크기가 올바르지 않습니다.");
    }
    return bytes;
  }

  private async createUploadSession(accessToken: string, params: PublishContentParams, contentLength: number): Promise<URL> {
    const url = new URL(YOUTUBE_UPLOAD_URL);
    url.searchParams.set("uploadType", "resumable");
    url.searchParams.set("part", "snippet,status");
    url.searchParams.set("notifySubscribers", "false");
    const response = await this.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(contentLength),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify({
          snippet: {
            title: safeTitle(params.title),
            description: params.content.trim().slice(0, 5_000),
            categoryId: "22",
          },
          status: {
            privacyStatus: "private",
            selfDeclaredMadeForKids: false,
          },
        }),
      },
      "YouTube 업로드 세션을 만들지 못했습니다.",
    );
    const location = response.headers.get("location");
    if (!location) throw new ConnectorError("youtube", "UPSTREAM_SERVER_ERROR", "YouTube 업로드 주소를 받지 못했습니다.");
    let uploadUrl: URL;
    try {
      uploadUrl = new URL(location);
    } catch (cause) {
      throw new ConnectorError("youtube", "UPSTREAM_SERVER_ERROR", "YouTube가 올바르지 않은 업로드 주소를 반환했습니다.", { cause });
    }
    if (uploadUrl.protocol !== "https:" || !uploadUrl.hostname.endsWith("googleapis.com")) {
      throw new ConnectorError("youtube", "UPSTREAM_SERVER_ERROR", "YouTube가 신뢰할 수 없는 업로드 주소를 반환했습니다.");
    }
    return uploadUrl;
  }

  async publish(params: PublishContentParams): Promise<PublishResult> {
    const credentials = this.credentials();
    const sourceUrl = videoTarget(params.videoUrl);
    const video = await this.downloadVideo(sourceUrl);
    const accessToken = await refreshYouTubeAccessToken(credentials, this.fetchFn);
    const uploadUrl = await this.createUploadSession(accessToken, params, video.byteLength);
    const response = await this.request(
      uploadUrl,
      {
        method: "PUT",
        headers: {
          "Content-Length": String(video.byteLength),
          "Content-Type": "video/mp4",
        },
        body: video,
      },
      "YouTube Shorts 영상을 업로드하지 못했습니다.",
    );

    let uploaded: YouTubeUploadResponse;
    try {
      uploaded = (await response.json()) as YouTubeUploadResponse;
    } catch (cause) {
      throw new ConnectorError("youtube", "UPSTREAM_SERVER_ERROR", "YouTube 업로드 응답을 읽지 못했습니다.", { cause });
    }
    if (!uploaded.id || uploaded.status?.privacyStatus !== "private") {
      throw new ConnectorError("youtube", "UPSTREAM_SERVER_ERROR", "YouTube가 비공개 업로드 결과를 반환하지 않았습니다.");
    }
    return {
      externalId: uploaded.id,
      externalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(uploaded.id)}`,
    };
  }
}
