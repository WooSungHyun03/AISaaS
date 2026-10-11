import "server-only";
import { serverEnv } from "@/lib/env/server";
import { ConnectorError, type ConnectorErrorCode } from "@/server/shared/errors";
import { getConnection, getConnectionSecret } from "../integrations";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { YOUTUBE_ANALYTICS_SCOPE } from "@/lib/youtube-scopes";
import { refreshYouTubeAccessToken } from "./oauth";

/**
 * YouTube Analytics API (owner-only reports) — a different thing from the
 * public Data API numbers the channel tracker already collects with an API
 * key. These need the channel owner's OAuth consent (`yt-analytics.readonly`)
 * and describe only that owner's own channel.
 *
 * Verified against developers.google.com/youtube/analytics (Channel reports,
 * `reports.query`): `ids=channel==MINE`, `dimensions=day`, metrics `views`,
 * `estimatedMinutesWatched`, `averageViewDuration`, `subscribersGained`,
 * `subscribersLost`. Data lags 48–72h, so the newest days come back empty.
 */
const REPORTS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";
export const ANALYTICS_METRICS = ["views", "estimatedMinutesWatched", "averageViewDuration", "subscribersGained", "subscribersLost"] as const;
const REQUEST_TIMEOUT_MS = 15_000;
/** How far back each collection reaches; wide enough to fill a 30-day report and its previous period after a few missed runs. */
export const ANALYTICS_WINDOW_DAYS = 70;
const DAY_MS = 86_400_000;

/** Why an Analytics call could not deliver data — what the owner has to do about it. */
export type YouTubeAnalyticsFailure =
  | "SCOPE_MISSING" // consent did not include yt-analytics.readonly -> reconnect
  | "TOKEN_REVOKED" // refresh token no longer valid -> reconnect
  | "API_DISABLED" // YouTube Analytics API is off in the Google Cloud project -> operator
  | "QUOTA" // daily/rate quota used up -> wait
  | "CHANNEL_MISMATCH" // the signed-in Google account does not own the tracked channel
  | "NOT_CONFIGURED" // Google OAuth client is not configured on the server
  | "UNKNOWN";

export class YouTubeAnalyticsError extends ConnectorError {
  constructor(
    readonly failure: YouTubeAnalyticsFailure,
    code: ConnectorErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super("youtube", code, message, options);
    this.name = "YouTubeAnalyticsError";
  }
}

export interface YouTubeAnalyticsDay {
  /** The day this row describes, as reported by the API (`day` dimension). */
  date: string;
  views: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;
  subscribersGained: number;
  subscribersLost: number;
}

interface ReportsResponse {
  columnHeaders?: Array<{ name?: string }>;
  rows?: Array<Array<string | number>>;
}

interface GoogleErrorBody {
  error?: { code?: number; status?: string; message?: string; errors?: Array<{ reason?: string }> };
}

/** Turns a Google error response into the one thing the owner (or operator) can act on. */
export async function classifyAnalyticsResponse(response: Response): Promise<YouTubeAnalyticsError> {
  let body: GoogleErrorBody = {};
  try {
    body = (await response.json()) as GoogleErrorBody;
  } catch {
    /* an unreadable body still has a status code to classify by */
  }
  const reason = body.error?.errors?.[0]?.reason ?? "";
  const message = body.error?.message ?? "";
  const status = response.status;

  if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason + body.error?.status) || /has not been used|is disabled/i.test(message)) {
    return new YouTubeAnalyticsError("API_DISABLED", "NOT_CONFIGURED", "YouTube Analytics API가 Google Cloud 프로젝트에서 켜져 있지 않아요.");
  }
  if (/quotaExceeded|rateLimitExceeded|dailyLimitExceeded|userRateLimitExceeded/i.test(reason) || status === 429) {
    return new YouTubeAnalyticsError("QUOTA", "UPSTREAM_SERVER_ERROR", "YouTube Analytics 호출 한도를 넘었어요. 잠시 후 다시 시도돼요.");
  }
  if (status === 401) {
    return new YouTubeAnalyticsError("TOKEN_REVOKED", "AUTH_FAILED", "YouTube 연결이 만료됐어요. 다시 연결해주세요.");
  }
  if (status === 403) {
    return new YouTubeAnalyticsError("SCOPE_MISSING", "PERMISSION_DENIED", "YouTube Analytics 권한이 없어요. YouTube를 다시 연결하며 Analytics 권한을 허용해주세요.");
  }
  return new YouTubeAnalyticsError("UNKNOWN", status >= 500 ? "UPSTREAM_SERVER_ERROR" : "UPSTREAM_CLIENT_ERROR", `YouTube Analytics 요청에 실패했어요 (HTTP ${status}).`);
}

async function googleFetch(url: URL, accessToken: string, fetchFn: typeof fetch): Promise<Response> {
  try {
    return await fetchFn(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
      throw new YouTubeAnalyticsError("UNKNOWN", "TIMEOUT", "YouTube Analytics 응답이 늦어요.", { cause });
    }
    throw new YouTubeAnalyticsError("UNKNOWN", "NETWORK_FAILURE", "YouTube Analytics에 연결하지 못했어요.", { cause });
  }
}

function toNumber(value: string | number | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Daily channel report for `startDate..endDate` (inclusive, YYYY-MM-DD). Rows are matched by column name, never by position. */
export async function queryYouTubeAnalyticsDaily(params: {
  accessToken: string;
  startDate: string;
  endDate: string;
  fetchFn?: typeof fetch;
}): Promise<YouTubeAnalyticsDay[]> {
  const url = new URL(REPORTS_URL);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("startDate", params.startDate);
  url.searchParams.set("endDate", params.endDate);
  url.searchParams.set("metrics", ANALYTICS_METRICS.join(","));
  url.searchParams.set("dimensions", "day");
  url.searchParams.set("sort", "day");

  const response = await googleFetch(url, params.accessToken, params.fetchFn ?? fetch);
  if (!response.ok) throw await classifyAnalyticsResponse(response);

  let body: ReportsResponse;
  try {
    body = (await response.json()) as ReportsResponse;
  } catch (cause) {
    throw new YouTubeAnalyticsError("UNKNOWN", "UPSTREAM_SERVER_ERROR", "YouTube Analytics 응답 형식이 올바르지 않아요.", { cause });
  }

  const names = (body.columnHeaders ?? []).map((column) => column.name ?? "");
  const column = (name: string) => names.indexOf(name);
  const dayIndex = column("day");
  if (dayIndex < 0) throw new YouTubeAnalyticsError("UNKNOWN", "UPSTREAM_SERVER_ERROR", "YouTube Analytics 응답에 날짜 열이 없어요.");

  return (body.rows ?? [])
    .map((row) => ({
      date: String(row[dayIndex] ?? ""),
      views: toNumber(row[column("views")]),
      estimatedMinutesWatched: toNumber(row[column("estimatedMinutesWatched")]),
      averageViewDuration: toNumber(row[column("averageViewDuration")]),
      subscribersGained: toNumber(row[column("subscribersGained")]),
      subscribersLost: toNumber(row[column("subscribersLost")]),
    }))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date));
}

/** The channel id behind a tracked channel's id-or-handle, asked with the owner's token (1 quota unit). */
async function resolveTrackedChannelId(externalId: string, accessToken: string, fetchFn: typeof fetch): Promise<string | null> {
  if (!externalId.startsWith("@")) return externalId;
  const url = new URL(CHANNELS_URL);
  url.searchParams.set("part", "id");
  url.searchParams.set("forHandle", externalId);
  const response = await googleFetch(url, accessToken, fetchFn);
  if (!response.ok) throw await classifyAnalyticsResponse(response);
  const body = (await response.json().catch(() => ({}))) as { items?: Array<{ id?: string }> };
  return body.items?.[0]?.id ?? null;
}

function connectedChannelId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).channelId;
  return typeof value === "string" && value ? value : null;
}

/** KST calendar date (YYYY-MM-DD) for an instant. */
function kstDay(timeMs: number): string {
  return new Date(timeMs + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Real collector: refreshes the owner's access token, makes sure the Google
 * account that consented really owns the channel being tracked (so one
 * user's login can never feed another channel's numbers), then reads the
 * trailing daily report. Throws a `YouTubeAnalyticsError` that says what the
 * owner has to fix; the caller turns it into a notice instead of fake data.
 */
export async function collectYouTubeAnalyticsLive(
  params: { userId: string; businessId: string; externalId: string; now: Date },
  deps: { admin?: SupabaseClient<Database>; fetchFn?: typeof fetch } = {},
): Promise<YouTubeAnalyticsDay[]> {
  const admin = deps.admin ?? createAdminClient();
  const fetchFn = deps.fetchFn ?? fetch;

  if (!serverEnv.YOUTUBE_CLIENT_ID || !serverEnv.YOUTUBE_CLIENT_SECRET) {
    throw new YouTubeAnalyticsError("NOT_CONFIGURED", "NOT_CONFIGURED", "Google OAuth 설정(YOUTUBE_CLIENT_ID/SECRET)이 없어요.");
  }
  const connection = await getConnection(admin, params.userId, params.businessId, "youtube");
  if (!connection || connection.status !== "CONNECTED") {
    throw new YouTubeAnalyticsError("TOKEN_REVOKED", "AUTH_FAILED", "YouTube 연결이 없어요.");
  }
  const scope = (connection.metadata as Record<string, unknown> | null)?.scope;
  if (typeof scope !== "string" || !scope.split(/\s+/).includes(YOUTUBE_ANALYTICS_SCOPE)) {
    throw new YouTubeAnalyticsError("SCOPE_MISSING", "PERMISSION_DENIED", "Analytics 권한이 없어요. YouTube를 다시 연결해주세요.");
  }
  const refreshToken = await getConnectionSecret(admin, connection);
  if (!refreshToken) throw new YouTubeAnalyticsError("TOKEN_REVOKED", "AUTH_FAILED", "YouTube 연결 토큰이 없어요.");

  let accessToken: string;
  try {
    accessToken = await refreshYouTubeAccessToken({ clientId: serverEnv.YOUTUBE_CLIENT_ID, clientSecret: serverEnv.YOUTUBE_CLIENT_SECRET, refreshToken }, fetchFn);
  } catch (cause) {
    // A 400 from Google's token endpoint means the grant was revoked or expired.
    throw new YouTubeAnalyticsError("TOKEN_REVOKED", "AUTH_FAILED", "YouTube 연결이 만료됐어요. 다시 연결해주세요.", { cause });
  }

  const connected = connectedChannelId(connection.metadata);
  const tracked = await resolveTrackedChannelId(params.externalId, accessToken, fetchFn);
  if (!connected || !tracked || connected !== tracked) {
    throw new YouTubeAnalyticsError("CHANNEL_MISMATCH", "PERMISSION_DENIED", "연결한 구글 계정의 채널과 추적 중인 채널이 달라요.");
  }

  // The API cannot report the last ~3 days yet; asking up to yesterday is harmless and returns what is ready.
  const endDate = kstDay(params.now.getTime() - DAY_MS);
  const startDate = kstDay(params.now.getTime() - ANALYTICS_WINDOW_DAYS * DAY_MS);
  return queryYouTubeAnalyticsDaily({ accessToken, startDate, endDate, fetchFn });
}
