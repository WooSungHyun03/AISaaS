import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => vi.resetModules());

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.doMock("@/lib/env/server", () => ({ serverEnv: env }));
  vi.doMock("@/lib/env/client", () => ({ clientEnv: { NEXT_PUBLIC_SITE_URL: "https://app.example.com" } }));
  return (await import("./config-status")).getIntegrationConfigStatus();
}

describe("getIntegrationConfigStatus", () => {
  it("reports exactly which variables are missing, never their values", async () => {
    const status = await load({ YOUTUBE_CLIENT_ID: "id" });
    expect(status.youtube).toMatchObject({ configured: false, missing: ["YOUTUBE_CLIENT_SECRET"] });
    expect(Object.keys(status)).toEqual(["youtube"]);
    expect(JSON.stringify(status)).not.toContain('"id"');
  });

  it("is configured only when both halves are present, and gives the redirect URI to register", async () => {
    const status = await load({ YOUTUBE_CLIENT_ID: "a", YOUTUBE_CLIENT_SECRET: "b" });
    expect(status.youtube.configured).toBe(true);
    expect(status.youtube.redirectUri).toBe("https://app.example.com/api/integrations/youtube/callback");
    expect(status.youtube.scopes).toContain("https://www.googleapis.com/auth/yt-analytics.readonly");
  });
});
