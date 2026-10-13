import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn(), secret: vi.fn(), status: vi.fn() }));
vi.mock("@/server/connectors/integrations", () => ({ createConnection: m.create, getConnection: m.get, getConnectionSecret: m.secret, updateConnectionStatus: m.status }));

const { loadInstagramConnector } = await import("./connect");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const DAY = 86_400_000;
const admin = {} as never;
const connection = (expiresInDays: number, updatedDaysAgo = 30) => ({
  id: "conn-1",
  status: "CONNECTED",
  account_identifier: "@shop",
  secret_reference: "ref",
  connected_at: new Date(Date.now() - 50 * DAY).toISOString(),
  updated_at: new Date(Date.now() - updatedDaysAgo * DAY).toISOString(),
  metadata: { accountId: "ig-1", accountType: "BUSINESS", expiresAt: new Date(Date.now() + expiresInDays * DAY).toISOString() },
});

describe("Instagram long-lived token", () => {
  it("is left alone while it has plenty of time left", async () => {
    m.get.mockResolvedValue(connection(40));
    m.secret.mockResolvedValue("token-1");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await loadInstagramConnector(admin, "u", "b")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("is renewed (another 60 days, stored in the vault) once less than 10 days are left", async () => {
    m.get.mockResolvedValue(connection(5));
    m.secret.mockResolvedValue("token-old");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "token-new", expires_in: 5_184_000 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const connector = await loadInstagramConnector(admin, "u", "b");

    expect(connector).not.toBeNull();
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://graph.instagram.com/refresh_access_token");
    expect(url.searchParams.get("grant_type")).toBe("ig_refresh_token");
    expect(url.searchParams.get("access_token")).toBeNull(); // the token travels in the Authorization header, not in the URL
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "u", businessId: "b", provider: "instagram", secret: "token-new", accountIdentifier: "@shop" }), admin);
    const saved = m.create.mock.calls[0][0].metadata as { expiresAt: string; accountId: string };
    expect(saved.accountId).toBe("ig-1");
    expect(Date.parse(saved.expiresAt) - Date.now()).toBeGreaterThan(59 * DAY);
  });

  it("is not refreshed before it is a day old (Instagram would refuse), and a failed refresh keeps the still-valid token", async () => {
    m.get.mockResolvedValue(connection(5, 0.2));
    m.secret.mockResolvedValue("token-old");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadInstagramConnector(admin, "u", "b")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    m.get.mockResolvedValue(connection(5));
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
    expect(await loadInstagramConnector(admin, "u", "b")).not.toBeNull();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("marks an expired connection EXPIRED and returns nothing: the owner has to connect again", async () => {
    m.get.mockResolvedValue(connection(-1));
    m.secret.mockResolvedValue("token-old");
    expect(await loadInstagramConnector(admin, "u", "b")).toBeNull();
    expect(m.status).toHaveBeenCalledWith(admin, "conn-1", "EXPIRED");
  });
});
