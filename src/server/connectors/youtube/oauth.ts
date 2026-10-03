import "server-only";
import { classifyHttpStatus, ConnectorError } from "@/server/shared/errors";

export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YOUTUBE_OAUTH_COOKIE = "autobiz_youtube_oauth";

export interface YouTubeToken {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  scope?: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
}

export function buildYouTubeAuthorizationUrl(params: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_UPLOAD_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", params.state);
  return url.toString();
}

async function fetchJson<T>(
  input: string | URL,
  init: RequestInit,
  fallback: string,
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(input, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch (cause) {
    if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
      throw new ConnectorError("youtube", "TIMEOUT", `${fallback} (요청 시간 초과)`, { cause });
    }
    throw new ConnectorError("youtube", "NETWORK_FAILURE", `${fallback} (연결 실패)`, { cause });
  }
  if (!response.ok) {
    const code = response.status === 400 ? "AUTH_FAILED" : classifyHttpStatus(response.status);
    throw new ConnectorError("youtube", code, `${fallback} (HTTP ${response.status})`);
  }
  try {
    return (await response.json()) as T;
  } catch (cause) {
    throw new ConnectorError("youtube", "UPSTREAM_SERVER_ERROR", `${fallback} (응답 형식 오류)`, { cause });
  }
}

export async function exchangeYouTubeCode(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<YouTubeToken> {
  const token = await fetchJson<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  }>(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        code: params.code,
        grant_type: "authorization_code",
        redirect_uri: params.redirectUri,
      }),
    },
    "YouTube 인증 코드를 교환하지 못했습니다.",
  );
  if (!token.access_token || !token.refresh_token) {
    throw new ConnectorError("youtube", "AUTH_FAILED", "YouTube 장기 연결 토큰을 받지 못했습니다. 다시 동의해주세요.");
  }
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresIn: token.expires_in,
    scope: token.scope,
  };
}

export async function refreshYouTubeAccessToken(
  params: { clientId: string; clientSecret: string; refreshToken: string },
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const token = await fetchJson<{ access_token?: string }>(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: params.clientId,
        client_secret: params.clientSecret,
        refresh_token: params.refreshToken,
        grant_type: "refresh_token",
      }),
    },
    "YouTube 연결 토큰을 갱신하지 못했습니다.",
    fetchFn,
  );
  if (!token.access_token) throw new ConnectorError("youtube", "AUTH_FAILED", "YouTube access token을 받지 못했습니다.");
  return token.access_token;
}

export async function getYouTubeChannel(accessToken: string): Promise<YouTubeChannel> {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id,snippet");
  url.searchParams.set("mine", "true");
  const result = await fetchJson<{ items?: Array<{ id?: string; snippet?: { title?: string } }> }>(
    url,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "YouTube 채널 정보를 확인하지 못했습니다.",
  );
  const channel = result.items?.[0];
  if (!channel?.id || !channel.snippet?.title) {
    throw new ConnectorError("youtube", "INVALID_TARGET", "업로드할 YouTube 채널을 찾지 못했습니다.");
  }
  return { id: channel.id, title: channel.snippet.title };
}
