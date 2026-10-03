import { afterEach, describe, expect, it, vi } from "vitest";
import { isConnectorError } from "@/server/shared/errors";
import {
  buildYouTubeAuthorizationUrl,
  exchangeYouTubeCode,
  getYouTubeChannel,
  YOUTUBE_UPLOAD_SCOPE,
} from "./oauth";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("YouTube OAuth", () => {
  it("builds an offline authorization URL with youtube.upload and CSRF state", () => {
    const url = new URL(buildYouTubeAuthorizationUrl({
      clientId: "client-1",
      redirectUri: "https://app.example.com/api/integrations/youtube/callback",
      state: "csrf-state",
    }));

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(YOUTUBE_UPLOAD_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("csrf-state");
  });

  it("exchanges a code for access and refresh tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: YOUTUBE_UPLOAD_SCOPE,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const token = await exchangeYouTubeCode({
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "https://app.example.com/api/integrations/youtube/callback",
      code: "auth-code",
    });

    expect(token).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresIn: 3600,
      scope: YOUTUBE_UPLOAD_SCOPE,
    });
    const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_secret")).toBe("secret-1");
  });

  it("rejects an OAuth response that omits the refresh token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-only" }), { status: 200 })));

    const error = await exchangeYouTubeCode({
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "https://app.example.com/callback",
      code: "auth-code",
    }).catch((caught: unknown) => caught);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("AUTH_FAILED");
  });

  it("loads the authenticated YouTube channel", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      items: [{ id: "channel-1", snippet: { title: "우리 가게 채널" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getYouTubeChannel("access-1")).resolves.toEqual({ id: "channel-1", title: "우리 가게 채널" });
    const [requestUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(requestUrl.searchParams.get("mine")).toBe("true");
    expect(init.headers).toMatchObject({ Authorization: "Bearer access-1" });
  });
});
