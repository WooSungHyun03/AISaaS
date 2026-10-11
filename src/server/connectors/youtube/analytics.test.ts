import { afterEach, describe, expect, it, vi } from "vitest";

const { getConnectionMock, getConnectionSecretMock, envMock } = vi.hoisted(() => ({
  getConnectionMock: vi.fn(),
  getConnectionSecretMock: vi.fn(),
  envMock: { YOUTUBE_CLIENT_ID: "client-id", YOUTUBE_CLIENT_SECRET: "client-secret" } as Record<string, string | undefined>,
}));
vi.mock("../integrations", () => ({ getConnection: getConnectionMock, getConnectionSecret: getConnectionSecretMock }));
vi.mock("@/lib/env/server", () => ({ serverEnv: envMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const { classifyAnalyticsResponse, collectYouTubeAnalyticsLive, queryYouTubeAnalyticsDaily, YouTubeAnalyticsError } = await import("./analytics");

const NOW = new Date("2026-10-10T03:00:00.000Z");
const SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly";

afterEach(() => {
  vi.clearAllMocks();
  envMock.YOUTUBE_CLIENT_ID = "client-id";
  envMock.YOUTUBE_CLIENT_SECRET = "client-secret";
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const REPORT = {
  columnHeaders: [{ name: "day" }, { name: "subscribersLost" }, { name: "views" }, { name: "estimatedMinutesWatched" }, { name: "averageViewDuration" }, { name: "subscribersGained" }],
  rows: [["2026-10-05", 1, 120, 300, 80, 4], ["2026-10-06", 0, "150", 360, 90.5, 2]],
};

describe("queryYouTubeAnalyticsDaily", () => {
  it("asks for the owner's daily channel report and matches columns by name, not position", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(REPORT));

    const days = await queryYouTubeAnalyticsDaily({ accessToken: "token-1", startDate: "2026-10-01", endDate: "2026-10-09", fetchFn });

    const url = new URL(fetchFn.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://youtubeanalytics.googleapis.com/v2/reports");
    expect(url.searchParams.get("ids")).toBe("channel==MINE");
    expect(url.searchParams.get("dimensions")).toBe("day");
    expect(url.searchParams.get("metrics")).toBe("views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost");
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe("Bearer token-1");
    expect(days).toEqual([
      { date: "2026-10-05", views: 120, estimatedMinutesWatched: 300, averageViewDuration: 80, subscribersGained: 4, subscribersLost: 1 },
      { date: "2026-10-06", views: 150, estimatedMinutesWatched: 360, averageViewDuration: 90.5, subscribersGained: 2, subscribersLost: 0 },
    ]);
  });

  it("returns no days (not fake ones) when the API has no rows yet", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ columnHeaders: REPORT.columnHeaders }));
    await expect(queryYouTubeAnalyticsDaily({ accessToken: "t", startDate: "2026-10-01", endDate: "2026-10-09", fetchFn })).resolves.toEqual([]);
  });

  it("drops rows without a valid date", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ ...REPORT, rows: [["not-a-date", 1, 2, 3, 4, 5]] }));
    await expect(queryYouTubeAnalyticsDaily({ accessToken: "t", startDate: "2026-10-01", endDate: "2026-10-09", fetchFn })).resolves.toEqual([]);
  });

  it("turns a network failure into a typed error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(queryYouTubeAnalyticsDaily({ accessToken: "t", startDate: "a", endDate: "b", fetchFn })).rejects.toMatchObject({ failure: "UNKNOWN", code: "NETWORK_FAILURE" });
  });
});

describe("classifyAnalyticsResponse", () => {
  const classify = (status: number, error: unknown) => classifyAnalyticsResponse(json({ error }, status));

  it("recognises a Google Cloud project that never enabled the Analytics API", async () => {
    const error = await classify(403, { status: "PERMISSION_DENIED", message: "YouTube Analytics API has not been used in project 123 before or it is disabled.", errors: [{ reason: "accessNotConfigured" }] });
    expect(error).toBeInstanceOf(YouTubeAnalyticsError);
    expect(error.failure).toBe("API_DISABLED");
  });

  it("recognises quota exhaustion", async () => {
    expect((await classify(403, { errors: [{ reason: "quotaExceeded" }] })).failure).toBe("QUOTA");
    expect((await classify(429, {})).failure).toBe("QUOTA");
  });

  it("separates an expired login (401) from missing consent (403)", async () => {
    expect((await classify(401, { message: "Invalid Credentials" })).failure).toBe("TOKEN_REVOKED");
    expect((await classify(403, { errors: [{ reason: "insufficientPermissions" }] })).failure).toBe("SCOPE_MISSING");
  });

  it("never copies the provider's message (which may name a project) into ours", async () => {
    const error = await classify(500, { message: "internal project 99887 secret-ish" });
    expect(error.message).not.toContain("99887");
    expect(error.retryable).toBe(true);
  });
});

describe("collectYouTubeAnalyticsLive", () => {
  const connection = (metadata: Record<string, unknown> = {}) => ({ id: "conn-1", status: "CONNECTED", secret_reference: "secret-1", metadata: { channelId: "UC-owner", scope: SCOPE, ...metadata } });

  function fetchWith(handlers: { token?: Response; channels?: Response; report?: Response }) {
    return vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) return handlers.token ?? json({ access_token: "access-1" });
      if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) return handlers.channels ?? json({ items: [{ id: "UC-owner" }] });
      if (url.startsWith("https://youtubeanalytics.googleapis.com/v2/reports")) return handlers.report ?? json(REPORT);
      throw new Error(`unexpected ${url}`);
    });
  }

  const run = (fetchFn: ReturnType<typeof fetchWith>, externalId = "UC-owner") =>
    collectYouTubeAnalyticsLive({ userId: "user-1", businessId: "biz-1", externalId, now: NOW }, { admin: {} as never, fetchFn: fetchFn as never });

  it("refreshes the token, verifies the channel owner and returns the trailing window ending yesterday (KST)", async () => {
    getConnectionMock.mockResolvedValue(connection());
    getConnectionSecretMock.mockResolvedValue("refresh-1");
    const fetchFn = fetchWith({});

    const days = await run(fetchFn);

    expect(days).toHaveLength(2);
    const report = new URL(String(fetchFn.mock.calls.find(([url]) => String(url).includes("youtubeanalytics"))![0]));
    expect(report.searchParams.get("endDate")).toBe("2026-10-09");
    expect(report.searchParams.get("startDate")).toBe("2026-08-01");
    // The refresh token is sent to Google's token endpoint only, never to the reports API.
    const tokenBody = String((fetchFn.mock.calls[0] as unknown as [string, { body: unknown }])[1].body);
    expect(tokenBody).toContain("refresh_token=refresh-1");
  });

  it("resolves a tracked @handle with the owner's token before comparing channels", async () => {
    getConnectionMock.mockResolvedValue(connection());
    getConnectionSecretMock.mockResolvedValue("refresh-1");
    const fetchFn = fetchWith({ channels: json({ items: [{ id: "UC-owner" }] }) });

    await run(fetchFn, "@my-channel");

    const channelsCall = new URL(String(fetchFn.mock.calls.find(([url]) => String(url).includes("/youtube/v3/channels"))![0]));
    expect(channelsCall.searchParams.get("forHandle")).toBe("@my-channel");
  });

  it("refuses to feed a channel the signed-in Google account does not own", async () => {
    getConnectionMock.mockResolvedValue(connection());
    getConnectionSecretMock.mockResolvedValue("refresh-1");
    const fetchFn = fetchWith({});

    await expect(run(fetchFn, "UC-someone-else")).rejects.toMatchObject({ failure: "CHANNEL_MISMATCH" });
    expect(fetchFn.mock.calls.some(([url]) => String(url).includes("youtubeanalytics"))).toBe(false);
  });

  it("asks for a reconnect when the consent never included Analytics", async () => {
    getConnectionMock.mockResolvedValue(connection({ scope: "https://www.googleapis.com/auth/youtube.upload" }));
    await expect(run(fetchWith({}))).rejects.toMatchObject({ failure: "SCOPE_MISSING" });
  });

  it("asks for a reconnect when Google rejects the refresh token", async () => {
    getConnectionMock.mockResolvedValue(connection());
    getConnectionSecretMock.mockResolvedValue("refresh-1");
    await expect(run(fetchWith({ token: json({ error: "invalid_grant" }, 400) }))).rejects.toMatchObject({ failure: "TOKEN_REVOKED" });
  });

  it("reports a server without Google OAuth settings as not configured, before any network call", async () => {
    envMock.YOUTUBE_CLIENT_ID = undefined;
    const fetchFn = fetchWith({});
    await expect(run(fetchFn)).rejects.toMatchObject({ failure: "NOT_CONFIGURED" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("surfaces a disabled Analytics API from the report call", async () => {
    getConnectionMock.mockResolvedValue(connection());
    getConnectionSecretMock.mockResolvedValue("refresh-1");
    const report = json({ error: { status: "PERMISSION_DENIED", message: "YouTube Analytics API has not been used in project 1 before or it is disabled.", errors: [{ reason: "accessNotConfigured" }] } }, 403);
    await expect(run(fetchWith({ report }))).rejects.toMatchObject({ failure: "API_DISABLED" });
  });
});
