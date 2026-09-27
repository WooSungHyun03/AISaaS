import { afterEach, describe, expect, it, vi } from "vitest";
import { buildInstagramAuthorizationUrl, exchangeInstagramCode, getInstagramProfile, isProfessionalInstagramAccount } from "./oauth";

afterEach(() => vi.unstubAllGlobals());

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
});
