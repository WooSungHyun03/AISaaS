import { afterEach, describe, expect, it, vi } from "vitest";

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

const { completeInstagramOAuth, isMatchingOAuthState, loadInstagramConnector, parseInstagramOAuthCookie, startInstagramOAuth } = await import("./connect");
const { InstagramConnector } = await import("./index");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeAdmin = {} as any;

function shortTokenResponse(userId = "ig-user-1") {
  return new Response(JSON.stringify({ access_token: "short-secret", user_id: userId }), { status: 200 });
}

function longTokenResponse(expiresIn = 5_184_000) {
  return new Response(JSON.stringify({ access_token: "long-secret", expires_in: expiresIn }), { status: 200 });
}

function profileResponse(accountType: string, username = "shop") {
  return new Response(JSON.stringify({ user_id: "ig-user-1", username, account_type: accountType }), { status: 200 });
}

describe("startInstagramOAuth / parseInstagramOAuthCookie / isMatchingOAuthState", () => {
  it("round-trips the state and business id through the packed cookie value", () => {
    const { authorizationUrl, cookieValue } = startInstagramOAuth({ appId: "app-1", redirectUri: "https://app.example.com/callback", businessId: "biz-1" });
    const url = new URL(authorizationUrl);
    const state = url.searchParams.get("state");
    expect(state).toBeTruthy();

    const parsed = parseInstagramOAuthCookie(cookieValue);
    expect(parsed).toEqual({ state, businessId: "biz-1" });
    expect(isMatchingOAuthState(state!, parsed!.state)).toBe(true);
  });

  it("generates a different state on every call", () => {
    const first = startInstagramOAuth({ appId: "app-1", redirectUri: "https://app.example.com/callback", businessId: "biz-1" });
    const second = startInstagramOAuth({ appId: "app-1", redirectUri: "https://app.example.com/callback", businessId: "biz-1" });
    expect(new URL(first.authorizationUrl).searchParams.get("state")).not.toBe(new URL(second.authorizationUrl).searchParams.get("state"));
  });

  it("parseInstagramOAuthCookie rejects a missing, malformed, or incomplete value", () => {
    expect(parseInstagramOAuthCookie(undefined)).toBeNull();
    expect(parseInstagramOAuthCookie("not-base64url-json")).toBeNull();
    expect(parseInstagramOAuthCookie(Buffer.from(JSON.stringify({ state: "only-state" })).toString("base64url"))).toBeNull();
  });

  it("isMatchingOAuthState rejects a mismatched or wrong-length state", () => {
    expect(isMatchingOAuthState("abc", "abc")).toBe(true);
    expect(isMatchingOAuthState("abc", "xyz")).toBe(false);
    expect(isMatchingOAuthState("short", "much-longer-value")).toBe(false);
  });
});

describe("completeInstagramOAuth", () => {
  const params = { userId: "user-1", businessId: "biz-1", appId: "app-1", appSecret: "secret", redirectUri: "https://app.example.com/callback", code: "auth-code" };

  it("exchanges the code, verifies the professional account, and persists a CONNECTED row via Vault-backed createConnection()", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(shortTokenResponse())
      .mockResolvedValueOnce(longTokenResponse(5_184_000))
      .mockResolvedValueOnce(profileResponse("BUSINESS", "my-shop")));
    createConnectionMock.mockResolvedValueOnce({ id: "conn-1", status: "CONNECTED" });

    const outcome = await completeInstagramOAuth(params, fakeAdmin);

    expect(outcome).toBe("connected");
    expect(createConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        businessId: "biz-1",
        provider: "instagram",
        accountIdentifier: "@my-shop",
        secret: "long-secret",
        metadata: expect.objectContaining({ accountId: "ig-user-1", accountType: "BUSINESS", expiresAt: expect.any(String) }),
      }),
      fakeAdmin,
    );
    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it("rejects a personal account without persisting a connection or touching an existing one", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(shortTokenResponse())
      .mockResolvedValueOnce(longTokenResponse())
      .mockResolvedValueOnce(profileResponse("PERSONAL")));

    const outcome = await completeInstagramOAuth(params, fakeAdmin);

    expect(outcome).toBe("professional_required");
    expect(createConnectionMock).not.toHaveBeenCalled();
    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(updateConnectionStatusMock).not.toHaveBeenCalled();
  });

  it("marks a pre-existing connection ERROR when the code exchange itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })));
    getConnectionMock.mockResolvedValueOnce({ id: "conn-old" });

    const outcome = await completeInstagramOAuth(params, fakeAdmin);

    expect(outcome).toBe("error");
    expect(createConnectionMock).not.toHaveBeenCalled();
    expect(getConnectionMock).toHaveBeenCalledWith(fakeAdmin, "user-1", "biz-1", "instagram");
    expect(updateConnectionStatusMock).toHaveBeenCalledWith(fakeAdmin, "conn-old", "ERROR");
  });

  it("marks a pre-existing connection ERROR when the profile fetch fails after a successful token exchange", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(shortTokenResponse())
      .mockResolvedValueOnce(longTokenResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 })));
    getConnectionMock.mockResolvedValueOnce({ id: "conn-old" });

    const outcome = await completeInstagramOAuth(params, fakeAdmin);

    expect(outcome).toBe("error");
    expect(createConnectionMock).not.toHaveBeenCalled();
    expect(updateConnectionStatusMock).toHaveBeenCalledWith(fakeAdmin, "conn-old", "ERROR");
  });

  it("does not call updateConnectionStatus when there was no pre-existing connection to mark", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")));
    getConnectionMock.mockResolvedValueOnce(null);

    const outcome = await completeInstagramOAuth(params, fakeAdmin);

    expect(outcome).toBe("error");
    expect(updateConnectionStatusMock).not.toHaveBeenCalled();
  });

  it("still resolves to 'error' (never throws) when the ERROR-marking lookup itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")));
    getConnectionMock.mockRejectedValueOnce(new Error("db unavailable"));

    await expect(completeInstagramOAuth(params, fakeAdmin)).resolves.toBe("error");
  });
});

describe("loadInstagramConnector", () => {
  it("returns null when the business has no connection", async () => {
    getConnectionMock.mockResolvedValueOnce(null);
    const connector = await loadInstagramConnector(fakeAdmin, "user-1", "biz-1");
    expect(connector).toBeNull();
    expect(getConnectionSecretMock).not.toHaveBeenCalled();
  });

  it("returns null when the connection is not CONNECTED", async () => {
    getConnectionMock.mockResolvedValueOnce({ status: "DISCONNECTED", metadata: { accountId: "ig-user-1" } });
    const connector = await loadInstagramConnector(fakeAdmin, "user-1", "biz-1");
    expect(connector).toBeNull();
  });

  it("returns null when the stored secret is missing", async () => {
    getConnectionMock.mockResolvedValueOnce({ status: "CONNECTED", metadata: { accountId: "ig-user-1" } });
    getConnectionSecretMock.mockResolvedValueOnce(null);
    const connector = await loadInstagramConnector(fakeAdmin, "user-1", "biz-1");
    expect(connector).toBeNull();
  });

  it("returns null when the stored metadata has no accountId (ig user id)", async () => {
    getConnectionMock.mockResolvedValueOnce({ status: "CONNECTED", metadata: {} });
    getConnectionSecretMock.mockResolvedValueOnce("decrypted-token");
    const connector = await loadInstagramConnector(fakeAdmin, "user-1", "biz-1");
    expect(connector).toBeNull();
  });

  it("builds a connector from the decrypted token when the connection is CONNECTED", async () => {
    getConnectionMock.mockResolvedValueOnce({ status: "CONNECTED", metadata: { accountId: "ig-user-1" } });
    getConnectionSecretMock.mockResolvedValueOnce("decrypted-token");

    const connector = await loadInstagramConnector(fakeAdmin, "user-1", "biz-1");
    expect(connector).toBeInstanceOf(InstagramConnector);
    expect(connector!.isConfigured()).toBe(true);
  });
});
