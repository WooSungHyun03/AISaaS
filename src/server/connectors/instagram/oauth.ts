import "server-only";

export const INSTAGRAM_OAUTH_COOKIE = "autobiz_instagram_oauth";

export interface InstagramToken {
  accessToken: string;
  userId: string;
  expiresIn?: number;
}

export interface InstagramProfile {
  id: string;
  username: string;
  accountType: string;
}

export function buildInstagramAuthorizationUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", params.appId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_content_publish");
  url.searchParams.set("state", params.state);
  return url.toString();
}

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) throw new Error(`${fallback} (HTTP ${response.status})`);
  return response.json() as Promise<T>;
}

export async function exchangeInstagramCode(params: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<InstagramToken> {
  const body = new URLSearchParams({
    client_id: params.appId,
    client_secret: params.appSecret,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
    code: params.code,
  });
  const shortResponse = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const shortToken = await responseJson<{ access_token: string; user_id: string }>(shortResponse, "Instagram 인증 코드를 교환하지 못했습니다.");

  const longUrl = new URL("https://graph.instagram.com/access_token");
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", params.appSecret);
  longUrl.searchParams.set("access_token", shortToken.access_token);
  const longResponse = await fetch(longUrl, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const longToken = await responseJson<{ access_token: string; expires_in?: number }>(longResponse, "Instagram 장기 토큰을 발급하지 못했습니다.");
  return { accessToken: longToken.access_token, userId: shortToken.user_id, expiresIn: longToken.expires_in };
}

export async function getInstagramProfile(accessToken: string): Promise<InstagramProfile> {
  const url = new URL("https://graph.instagram.com/me");
  url.searchParams.set("fields", "user_id,username,account_type");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const profile = await responseJson<{ id?: string; user_id?: string; username?: string; account_type?: string }>(response, "Instagram 계정 정보를 확인하지 못했습니다.");
  const id = profile.user_id ?? profile.id;
  if (!id || !profile.username || !profile.account_type) throw new Error("Instagram 계정 정보가 완전하지 않습니다.");
  return { id, username: profile.username, accountType: profile.account_type };
}

export function isProfessionalInstagramAccount(accountType: string): boolean {
  return ["BUSINESS", "MEDIA_CREATOR", "CREATOR"].includes(accountType.toUpperCase());
}
