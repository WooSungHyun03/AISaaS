import "server-only";
import type { IntegrationConnection } from "@/types/domain";

/**
 * OAuth scope required to call the YouTube Analytics API (Channel reports).
 * Mirrors the upload scope's naming style in
 * src/server/connectors/youtube/oauth.ts (Dev1 area, not imported from here
 * to avoid a cross-owner dependency — see
 * docs/person1/REQUEST_FOR_DEV1_youtube_analytics.md for the actual scope
 * addition Dev1 needs to make at the OAuth-request side).
 */
export const YOUTUBE_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";

/**
 * Reads the OAuth scope string Dev1's completeYouTubeOAuth() already stores
 * in connection.metadata.scope (space-joined, per Google's token response
 * format) and checks whether it includes yt-analytics.readonly. A connected
 * user whose token predates this ticket will have this return false until
 * they re-run the OAuth flow (incremental authorization via
 * include_granted_scopes=true, already present in buildYouTubeAuthorizationUrl)
 * — that's the "needs reconnect" signal callers use to decide whether to
 * attempt Analytics collection.
 */
export function hasYouTubeAnalyticsScope(connection: Pick<IntegrationConnection, "metadata">): boolean {
  const metadata = connection.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;

  const scope = (metadata as Record<string, unknown>).scope;
  if (typeof scope !== "string" || scope.trim() === "") return false;

  return scope.split(/\s+/).includes(YOUTUBE_ANALYTICS_SCOPE);
}
