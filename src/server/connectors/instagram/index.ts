import "server-only";
import { serverEnv } from "@/lib/env/server";
import { classifyHttpStatus, ConnectorError } from "@/server/shared/errors";
import type { PlatformConnector, PublishContentParams, PublishResult } from "../types";

const GRAPH_API_BASE = "https://graph.instagram.com/v21.0";
/** Bounded polling for the media container's processing status — never unbounded (Rule 29). */
const MEDIA_STATUS_MAX_ATTEMPTS = 10;
const MEDIA_STATUS_POLL_INTERVAL_MS = 5_000;

export interface InstagramConnection {
  accessToken: string;
  igUserId: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Instagram Content Publishing (Meta Graph API) connector for a single
 * static image or Reel. Carousels remain out of scope.
 * Mirrors `WordPressConnector`'s constructor shape: an explicit
 * `InstagramConnection` (from a business's Vault-backed
 * `integration_connections` row, see `./connect.ts#loadInstagramConnector`)
 * takes priority, falling back to the legacy env-configured single-account
 * path (`META_ACCESS_TOKEN`/`META_IG_USER_ID`) when none is given.
 */
export class InstagramConnector implements PlatformConnector {
  readonly name = "instagram";

  constructor(
    private readonly connection?: InstagramConnection,
    private readonly options?: { pollIntervalMs?: number },
  ) {}

  isConfigured(): boolean {
    if (this.connection) return Boolean(this.connection.accessToken && this.connection.igUserId);
    return Boolean(serverEnv.META_ACCESS_TOKEN && serverEnv.META_IG_USER_ID);
  }

  private credentials(): InstagramConnection {
    if (this.connection) return this.connection;
    if (!this.isConfigured()) throw new ConnectorError("instagram", "NOT_CONFIGURED", "Instagram 연결이 설정되지 않았습니다.");
    return { accessToken: serverEnv.META_ACCESS_TOKEN!, igUserId: serverEnv.META_IG_USER_ID! };
  }

  /** Same fetch/classify shape as oauth.ts's fetchJson() — kept local since this class owns its own credentials. */
  private async fetchJson<T>(url: URL, init: RequestInit, fallback: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "TimeoutError") {
        throw new ConnectorError("instagram", "TIMEOUT", `${fallback} (요청 시간 초과)`, { cause });
      }
      throw new ConnectorError("instagram", "NETWORK_FAILURE", `${fallback} (연결 실패)`, { cause });
    }
    if (!response.ok) {
      throw new ConnectorError("instagram", classifyHttpStatus(response.status), `${fallback} (HTTP ${response.status})`);
    }
    return response.json() as Promise<T>;
  }

  private async createMediaContainer(params: {
    caption: string;
    imageUrl?: string;
    mediaType: "IMAGE" | "REELS";
    videoUrl?: string;
  }): Promise<string> {
    const { accessToken, igUserId } = this.credentials();
    const url = new URL(`${GRAPH_API_BASE}/${igUserId}/media`);
    if (params.mediaType === "REELS") {
      url.searchParams.set("media_type", "REELS");
      url.searchParams.set("video_url", params.videoUrl!);
    } else {
      url.searchParams.set("image_url", params.imageUrl!);
    }
    url.searchParams.set("caption", params.caption);
    url.searchParams.set("access_token", accessToken);
    const result = await this.fetchJson<{ id?: string }>(url, { method: "POST" }, "Instagram 게시물 컨테이너를 생성하지 못했습니다.");
    if (!result.id) throw new ConnectorError("instagram", "UPSTREAM_SERVER_ERROR", "Instagram 게시물 컨테이너 ID를 받지 못했습니다.");
    return result.id;
  }

  /**
   * Polls the container's `status_code` up to MEDIA_STATUS_MAX_ATTEMPTS
   * times before giving up as `TIMEOUT` ("stuck"). Reels take longer than
   * static images, so both media paths use the video-safe bounded window.
   * Meta's API contract requires checking before `media_publish`.
   */
  private async waitForContainerReady(creationId: string): Promise<void> {
    const { accessToken } = this.credentials();
    const pollIntervalMs = this.options?.pollIntervalMs ?? MEDIA_STATUS_POLL_INTERVAL_MS;

    for (let attempt = 0; attempt < MEDIA_STATUS_MAX_ATTEMPTS; attempt++) {
      const url = new URL(`${GRAPH_API_BASE}/${creationId}`);
      url.searchParams.set("fields", "status_code");
      url.searchParams.set("access_token", accessToken);
      const status = await this.fetchJson<{ status_code?: string }>(url, {}, "Instagram 게시물 처리 상태를 확인하지 못했습니다.");

      if (status.status_code === "FINISHED") return;
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
        throw new ConnectorError("instagram", "UPSTREAM_SERVER_ERROR", `Instagram 게시물 처리에 실패했습니다 (${status.status_code}).`);
      }
      if (attempt < MEDIA_STATUS_MAX_ATTEMPTS - 1) await delay(pollIntervalMs);
    }
    throw new ConnectorError("instagram", "TIMEOUT", "Instagram 게시물 처리가 시간 내에 완료되지 않았습니다.");
  }

  private async publishMediaContainer(creationId: string): Promise<string> {
    const { accessToken, igUserId } = this.credentials();
    const url = new URL(`${GRAPH_API_BASE}/${igUserId}/media_publish`);
    url.searchParams.set("creation_id", creationId);
    url.searchParams.set("access_token", accessToken);
    const result = await this.fetchJson<{ id?: string }>(url, { method: "POST" }, "Instagram 게시물을 발행하지 못했습니다.");
    if (!result.id) throw new ConnectorError("instagram", "UPSTREAM_SERVER_ERROR", "Instagram 게시물 ID를 받지 못했습니다.");
    return result.id;
  }

  /** create media container -> poll status -> media_publish for an image or Reel. */
  async publish({ content, imageUrl, mediaType = "IMAGE", videoUrl }: PublishContentParams): Promise<PublishResult> {
    if (mediaType === "REELS" && !videoUrl) {
      throw new ConnectorError("instagram", "INVALID_TARGET", "Instagram Reels 게시물에는 영상 URL이 필요합니다.");
    }
    if (mediaType === "IMAGE" && !imageUrl) {
      throw new ConnectorError("instagram", "INVALID_TARGET", "Instagram 게시물에는 이미지 URL이 필요합니다.");
    }

    const creationId = await this.createMediaContainer({ caption: content, imageUrl, mediaType, videoUrl });
    await this.waitForContainerReady(creationId);
    const mediaId = await this.publishMediaContainer(creationId);
    return { externalId: mediaId };
  }
}
