import "server-only";
import { serverEnv } from "@/lib/env/server";
import { YouTubeCollectorError } from "./youtube-types";
import type { YouTubeDataProvider, YouTubeRawMetrics, YouTubeRecentVideo } from "./youtube-types";

/**
 * Public YouTube Data API v3 collector (API key only, no OAuth — a
 * different concern from src/server/connectors/youtube, which publishes
 * Shorts to a connected channel). Quota costs confirmed against
 * developers.google.com on 2026-10-10: channels.list / playlistItems.list /
 * videos.list are each 1 unit per call — search.list is deliberately never
 * used here (see ticket 1-2 plan: it shares a separate, small 100
 * calls/day "Search Queries" bucket this project's shared API key doesn't
 * need to spend on channel lookups that channels.list already covers).
 */
const API_BASE = "https://www.googleapis.com/youtube/v3";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RECENT_VIDEOS = 50;
const VIDEOS_BATCH_SIZE = 50;

interface YouTubeApiErrorBody {
  error?: { code?: number; message?: string; errors?: Array<{ reason?: string; domain?: string }> };
}

interface ChannelsListItem {
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean; viewCount?: string; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

interface PlaylistItemsItem {
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
}

interface VideosListItem {
  id?: string;
  statistics?: { viewCount?: string };
}

function toNumber(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const NOT_FOUND_REASONS = new Set(["channelNotFound", "channelClosed", "channelSuspended"]);

export class YouTubeChannelDataProvider implements YouTubeDataProvider {
  async collect(externalId: string): Promise<YouTubeRawMetrics> {
    const idParam: Record<string, string> = externalId.startsWith("@") ? { forHandle: externalId } : { id: externalId };
    const channels = await this.request<{ items?: ChannelsListItem[] }>("channels", {
      part: "snippet,statistics,contentDetails",
      ...idParam,
    });

    const channel = channels.items?.[0];
    if (!channel) throw new YouTubeCollectorError("CHANNEL_NOT_FOUND", "채널을 찾을 수 없습니다.");

    const stats = channel.statistics ?? {};
    const hiddenSubscriberCount = stats.hiddenSubscriberCount === true;
    const subscriberCount = hiddenSubscriberCount ? null : toNumber(stats.subscriberCount);
    const viewCount = toNumber(stats.viewCount);
    const videoCount = toNumber(stats.videoCount);
    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;

    const recentVideos = uploadsPlaylistId ? await this.collectRecentVideos(uploadsPlaylistId) : [];

    return { subscriberCount, hiddenSubscriberCount, viewCount, videoCount, recentVideos };
  }

  /** playlistItems.list (max 50) for video ids + publish dates, then videos.list batched by 50 for view counts. */
  private async collectRecentVideos(uploadsPlaylistId: string): Promise<YouTubeRecentVideo[]> {
    const playlistItems = await this.request<{ items?: PlaylistItemsItem[] }>("playlistItems", {
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: String(MAX_RECENT_VIDEOS),
    });

    const videoRefs = (playlistItems.items ?? [])
      .map((item) => ({ videoId: item.contentDetails?.videoId, publishedAt: item.contentDetails?.videoPublishedAt }))
      .filter((ref): ref is { videoId: string; publishedAt: string } => Boolean(ref.videoId && ref.publishedAt));

    if (videoRefs.length === 0) return [];

    const viewCountByVideoId = new Map<string, number>();
    for (let i = 0; i < videoRefs.length; i += VIDEOS_BATCH_SIZE) {
      const batch = videoRefs.slice(i, i + VIDEOS_BATCH_SIZE);
      const videos = await this.request<{ items?: VideosListItem[] }>("videos", {
        part: "statistics",
        id: batch.map((ref) => ref.videoId).join(","),
      });
      for (const item of videos.items ?? []) {
        if (item.id) viewCountByVideoId.set(item.id, toNumber(item.statistics?.viewCount));
      }
    }

    return videoRefs
      .map((ref) => ({ publishedAt: ref.publishedAt, viewCount: viewCountByVideoId.get(ref.videoId) ?? 0 }))
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    const apiKey = serverEnv.YOUTUBE_API_KEY;
    if (!apiKey) throw new YouTubeCollectorError("INVALID_API_KEY", "YOUTUBE_API_KEY가 설정되지 않았습니다.");

    const url = new URL(`${API_BASE}/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("key", apiKey);

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    } catch (cause) {
      if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
        throw new YouTubeCollectorError("TIMEOUT", "YouTube API 응답이 시간 초과됐습니다.", { cause });
      }
      throw new YouTubeCollectorError("UNKNOWN", "YouTube API에 연결하지 못했습니다.", { cause });
    }

    if (!response.ok) await this.throwClassified(response);
    return (await response.json()) as T;
  }

  private async throwClassified(response: Response): Promise<never> {
    let reason: string | undefined;
    try {
      const body = (await response.json()) as YouTubeApiErrorBody;
      reason = body.error?.errors?.[0]?.reason;
    } catch {
      // Non-JSON error body — fall through, reason stays undefined.
    }

    if (response.status === 404 || (reason && NOT_FOUND_REASONS.has(reason))) {
      throw new YouTubeCollectorError("CHANNEL_NOT_FOUND", "채널을 찾을 수 없습니다.");
    }
    if (response.status === 403 && reason === "quotaExceeded") {
      throw new YouTubeCollectorError("QUOTA_EXCEEDED", "YouTube API 일일 쿼터를 초과했습니다.");
    }
    if (response.status === 400 || response.status === 403) {
      // developers.google.com doesn't document an exact reason string for a
      // revoked/restricted key as of 2026-10-10 — this is a best-effort
      // classification, not a confirmed mapping. The real `reason` is kept
      // out of the user-facing message but preserved as `cause` for logs.
      throw new YouTubeCollectorError("INVALID_API_KEY", `YouTube API 키가 거부됐습니다 (HTTP ${response.status}).`, { cause: reason });
    }
    throw new YouTubeCollectorError("UNKNOWN", `YouTube API 요청이 실패했습니다 (HTTP ${response.status}).`, { cause: reason });
  }
}
