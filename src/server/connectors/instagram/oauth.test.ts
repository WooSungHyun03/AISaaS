import { afterEach, describe, expect, it, vi } from "vitest";
import { isConnectorError } from "@/server/shared/errors";
import { buildInstagramAuthorizationUrl, exchangeInstagramCode, getInstagramProfile, isProfessionalInstagramAccount } from "./oauth";

afterEach(() => vi.unstubAllGlobals());

const exchangeParams = { appId: "app", appSecret: "secret", redirectUri: "https://app.example.com/callback", code: "code" };

describe("Instagram OAuth", () => {
  it("builds an authorization URL with state and current professional scopes", () => {
    const url = new URL(buildInstagramAuthorizationUrl({ appId: "app-1", redirectUri: "https://app.example.com/callback", state: "random-state" }));
    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.searchParams.get("state")).toBe("random-state");
    expect(url.searchParams.get("scope")).toContain("instagram_business_basic");
    expect(url.searchParams.get("scope")).toContain("instagram_business_content_publish");
  });

  it("exchanges the code and upgrades the token without returning the short token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "short-secret", user_id: "ig-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "long-secret", expires_in: 5_000 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await exchangeInstagramCode({ appId: "app", appSecret: "secret", redirectUri: "https://app.example.com/callback", code: "code" });
    expect(result).toEqual({ accessToken: "long-secret", userId: "ig-1", expiresIn: 5_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads profile fields and accepts only professional account types", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ user_id: "ig-1", username: "shop", account_type: "BUSINESS" }), { status: 200 })));
    await expect(getInstagramProfile("token")).resolves.toEqual({ id: "ig-1", username: "shop", accountType: "BUSINESS" });
    expect(isProfessionalInstagramAccount("BUSINESS")).toBe(true);
    expect(isProfessionalInstagramAccount("MEDIA_CREATOR")).toBe(true);
    expect(isProfessionalInstagramAccount("PERSONAL")).toBe(false);
  });

  it("classifies a rejected code exchange (invalid/expired/reused authorization code) as AUTH_FAILED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 })));
    const error = await exchangeInstagramCode(exchangeParams).catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("AUTH_FAILED");
  });

  it("classifies a permission-denied response from the long-token exchange as PERMISSION_DENIED", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "short-secret", user_id: "ig-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })));
    const error = await exchangeInstagramCode(exchangeParams).catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("PERMISSION_DENIED");
  });

  it("classifies a 5xx from Meta as UPSTREAM_SERVER_ERROR (retryable)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("upstream error", { status: 503 })));
    const error = await exchangeInstagramCode(exchangeParams).catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("UPSTREAM_SERVER_ERROR");
    expect((error as { retryable: boolean }).retryable).toBe(true);
  });

  it("classifies a raw network failure as NETWORK_FAILURE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")));
    const error = await exchangeInstagramCode(exchangeParams).catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("NETWORK_FAILURE");
  });

  it("classifies an aborted (timed-out) request as TIMEOUT", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError")));
    const error = await exchangeInstagramCode(exchangeParams).catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("TIMEOUT");
  });

  it("rejects an auth-token response for a revoked/expired access token as AUTH_FAILED", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Error validating access token" } }), { status: 401 })));
    const error = await getInstagramProfile("revoked-token").catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("AUTH_FAILED");
  });

  it("rejects an incomplete profile response even on HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ user_id: "ig-1" }), { status: 200 })));
    const error = await getInstagramProfile("token").catch((e: unknown) => e);
    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("UPSTREAM_SERVER_ERROR");
  });
});
