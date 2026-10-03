import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { InstagramConnector } from "@/server/connectors/instagram";
import { loadInstagramConnector } from "@/server/connectors/instagram/connect";
import { getConnection, updateConnectionStatus } from "@/server/connectors/integrations";
import { YouTubeConnector } from "@/server/connectors/youtube";
import { loadYouTubeConnector } from "@/server/connectors/youtube/connect";
import { isConnectorError } from "@/server/shared/errors";
import type { ShortsPublishPlatform } from "@/types/automation";

export interface ShortsPublicationResult {
  externalId: string | null;
  externalUrl: string | null;
  privacy: "private" | null;
}

export interface PublishShortsInput {
  userId: string;
  businessId: string;
  title: string;
  caption: string;
  videoUrl: string;
  platforms: ShortsPublishPlatform[];
}

/**
 * Publishes one already-rendered video. Connection secrets stay inside the
 * connector layer; callers only receive public ids and URLs suitable for a
 * run output and UI.
 */
export async function publishShortsToPlatforms(input: PublishShortsInput) {
  const admin = createAdminClient();
  const platforms = [...new Set(input.platforms)];
  if (platforms.length === 0) throw new Error("게시할 플랫폼을 한 개 이상 선택해주세요.");

  const instagramConnection = platforms.includes("instagram")
    ? await getConnection(admin, input.userId, input.businessId, "instagram")
    : null;
  const youtubeConnection = platforms.includes("youtube")
    ? await getConnection(admin, input.userId, input.businessId, "youtube")
    : null;

  const instagram = platforms.includes("instagram")
    ? (instagramConnection
      ? await loadInstagramConnector(admin, input.userId, input.businessId)
      : new InstagramConnector())
    : null;
  const youtube = platforms.includes("youtube")
    ? (youtubeConnection
      ? await loadYouTubeConnector(admin, input.userId, input.businessId)
      : new YouTubeConnector())
    : null;

  if (platforms.includes("instagram") && (!instagram || !instagram.isConfigured())) {
    throw new Error("Instagram 연결이 없거나 만료됐습니다. 설정에서 다시 연결해주세요.");
  }
  if (platforms.includes("youtube") && (!youtube || !youtube.isConfigured())) {
    throw new Error("YouTube 연결이 없거나 만료됐습니다. 설정에서 다시 연결해주세요.");
  }

  const results: Partial<Record<ShortsPublishPlatform, ShortsPublicationResult>> = {};
  try {
    if (instagram) {
      const published = await instagram.publish({
        content: input.caption,
        mediaType: "REELS",
        videoUrl: input.videoUrl,
      });
      results.instagram = {
        externalId: published.externalId ?? null,
        externalUrl: published.externalUrl ?? null,
        privacy: null,
      };
    }
    if (youtube) {
      const published = await youtube.publish({
        title: input.title,
        content: input.caption,
        videoUrl: input.videoUrl,
      });
      results.youtube = {
        externalId: published.externalId ?? null,
        externalUrl: published.externalUrl ?? null,
        privacy: "private",
      };
    }
    return results;
  } catch (error) {
    const status = isConnectorError(error) && (error.code === "AUTH_FAILED" || error.code === "PERMISSION_DENIED")
      ? "EXPIRED"
      : "ERROR";
    const provider = isConnectorError(error) ? error.domain : null;
    if (provider === "instagram" && instagramConnection) await updateConnectionStatus(admin, instagramConnection.id, status);
    if (provider === "youtube" && youtubeConnection) await updateConnectionStatus(admin, youtubeConnection.id, status);
    throw error;
  }
}

