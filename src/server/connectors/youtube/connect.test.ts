import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/server", () => ({
  serverEnv: {
    YOUTUBE_CLIENT_ID: "client-1",
    YOUTUBE_CLIENT_SECRET: "secret-1",
    YOUTUBE_REFRESH_TOKEN: undefined,
  },
}));

const { createConnectionMock, getConnectionMock, getConnectionSecretMock, updateConnectionStatusMock } = vi.hoisted(() => ({
  createConnectionMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getConnectionSecretMock: vi.fn(),
  updateConnectionStatusMock: vi.fn(),
}));
vi.mock("@/server/connectors/integrations", () => ({
  createConnection: createConnectionMock,
  getConnection: getConnectionMock,
  getConnectionSecret: getConnectionSecretMock,
  updateConnectionStatus: updateConnectionStatusMock,
}));

const {
  completeYouTubeOAuth,
  isMatchingYouTubeOAuthState,
  loadYouTubeConnector,
  parseYouTubeOAuthCookie,
  startYouTubeOAuth,
} = await import("./connect");
const { YouTubeConnector } = await import("./index");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeAdmin = {} as any;
const oauthParams = {
  userId: "user-1",
  businessId: "biz-1",
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://app.example.com/api/integrations/youtube/callback",
  code: "auth-code",
};

describe("YouTube OAuth connection", () => {
  it("round-trips business and state through the HTTP-only cookie payload", () => {
    const started = startYouTubeOAuth({
      clientId: "client-1",
      redirectUri: oauthParams.redirectUri,
      businessId: "biz-1",
    });
    const state = new URL(started.authorizationUrl).searchParams.get("state");

    expect(parseYouTubeOAuthCookie(started.cookieValue)).toEqual({ state, businessId: "biz-1" });
    expect(isMatchingYouTubeOAuthState(state!, state!)).toBe(true);
    expect(isMatchingYouTubeOAuthState("wrong", state!)).toBe(false);
  });

  it("stores only the refresh token through the Vault-backed connection helper", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "short-lived-access",
        refresh_token: "vault-refresh-secret",
        scope: "https://www.googleapis.com/auth/youtube.upload",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: "channel-1", snippet: { title: "우리 가게 채널" } }],
      }), { status: 200 })));
    createConnectionMock.mockResolvedValueOnce({ id: "conn-1", status: "CONNECTED" });

    const outcome = await completeYouTubeOAuth(oauthParams, fakeAdmin);

    expect(outcome).toBe("connected");
    expect(createConnectionMock).toHaveBeenCalledWith({
      userId: "user-1",
      businessId: "biz-1",
      provider: "youtube",
      accountIdentifier: "우리 가게 채널",
      secret: "vault-refresh-secret",
      metadata: {
        channelId: "channel-1",
        scope: "https://www.googleapis.com/auth/youtube.upload",
        privacyStatus: "private",
      },
    }, fakeAdmin);
    expect(JSON.stringify(createConnectionMock.mock.calls[0])).not.toContain("short-lived-access");
  });

  it("marks an existing connection as ERROR when OAuth completion fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));
    getConnectionMock.mockResolvedValueOnce({ id: "conn-old" });

    await expect(completeYouTubeOAuth(oauthParams, fakeAdmin)).resolves.toBe("error");
    expect(updateConnectionStatusMock).toHaveBeenCalledWith(fakeAdmin, "conn-old", "ERROR");
  });
});

describe("loadYouTubeConnector", () => {
  it("returns null when no connected Vault token exists", async () => {
    getConnectionMock.mockResolvedValueOnce(null);
    await expect(loadYouTubeConnector(fakeAdmin, "user-1", "biz-1")).resolves.toBeNull();
    expect(getConnectionSecretMock).not.toHaveBeenCalled();
  });

  it("builds a configured connector from the decrypted refresh token", async () => {
    getConnectionMock.mockResolvedValueOnce({ id: "conn-1", status: "CONNECTED", secret_reference: "vault-1" });
    getConnectionSecretMock.mockResolvedValueOnce("decrypted-refresh-token");

    const connector = await loadYouTubeConnector(fakeAdmin, "user-1", "biz-1");

    expect(connector).toBeInstanceOf(YouTubeConnector);
    expect(connector?.isConfigured()).toBe(true);
  });
});
