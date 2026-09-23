import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isConnectorError } from "@/server/shared/errors";

const { httpsRequestMock } = vi.hoisted(() => ({ httpsRequestMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn().mockResolvedValue([{ address: "93.184.215.14", family: 4 }]) }));
vi.mock("node:https", () => ({ request: httpsRequestMock }));

const { createConnectionMock, getConnectionMock, getConnectionSecretMock } = vi.hoisted(() => ({
  createConnectionMock: vi.fn(),
  getConnectionMock: vi.fn(),
  getConnectionSecretMock: vi.fn(),
}));
vi.mock("@/server/connectors/integrations", () => ({
  createConnection: createConnectionMock,
  getConnection: getConnectionMock,
  getConnectionSecret: getConnectionSecretMock,
}));

const { loadWordPressConnector, verifyAndConnectWordPress } = await import("./connect");
const { WordPressConnector } = await import("./index");

afterEach(() => vi.clearAllMocks());

function makeMockRequest() {
  const request = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    setTimeout: vi.fn(),
  });
  return request;
}

function respondWithStatus(status: number) {
  httpsRequestMock.mockImplementation((_url: string, _options: object, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
    const request = makeMockRequest();
    const response = Object.assign(new EventEmitter(), { statusCode: status });
    queueMicrotask(() => {
      callback(response);
      response.emit("data", Buffer.from(JSON.stringify({ id: 1 })));
      response.emit("end");
    });
    return request;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakeAdmin = {} as any;

describe("verifyAndConnectWordPress", () => {
  it("persists a CONNECTED row via createConnection() only after verification succeeds", async () => {
    respondWithStatus(200);
    createConnectionMock.mockResolvedValueOnce({ id: "conn-1", status: "CONNECTED" });

    const result = await verifyAndConnectWordPress(
      { userId: "user-1", businessId: "biz-1", siteUrl: "https://example.com", username: "writer", appPassword: "secret" },
      fakeAdmin,
    );

    expect(httpsRequestMock.mock.calls[0][0]).toBe("https://example.com/wp-json/wp/v2/users/me");
    expect(createConnectionMock).toHaveBeenCalledWith(
      {
        userId: "user-1",
        businessId: "biz-1",
        provider: "wordpress",
        accountIdentifier: "https://example.com",
        secret: "secret",
        metadata: { username: "writer" },
      },
      fakeAdmin,
    );
    expect(result).toEqual({ id: "conn-1", status: "CONNECTED" });
  });

  it("never calls createConnection() when verification fails", async () => {
    respondWithStatus(401);

    const error = await verifyAndConnectWordPress(
      { userId: "user-1", businessId: "biz-1", siteUrl: "https://example.com", username: "writer", appPassword: "wrong" },
      fakeAdmin,
    ).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((error as any).code).toBe("AUTH_FAILED");
    expect(createConnectionMock).not.toHaveBeenCalled();
  });
});

describe("loadWordPressConnector", () => {
  it("returns null when the business has no connection", async () => {
    getConnectionMock.mockResolvedValueOnce(null);
    const connector = await loadWordPressConnector(fakeAdmin, "user-1", "biz-1");
    expect(connector).toBeNull();
    expect(getConnectionSecretMock).not.toHaveBeenCalled();
  });

  it("returns null when the connection is not CONNECTED", async () => {
    getConnectionMock.mockResolvedValueOnce({ status: "DISCONNECTED", account_identifier: "https://example.com", metadata: { username: "writer" } });
    const connector = await loadWordPressConnector(fakeAdmin, "user-1", "biz-1");
    expect(connector).toBeNull();
  });

  it("returns null when the stored secret is missing", async () => {
    getConnectionMock.mockResolvedValueOnce({ status: "CONNECTED", account_identifier: "https://example.com", metadata: { username: "writer" } });
    getConnectionSecretMock.mockResolvedValueOnce(null);
    const connector = await loadWordPressConnector(fakeAdmin, "user-1", "biz-1");
    expect(connector).toBeNull();
  });

  it("builds a connector from the decrypted secret when the connection is CONNECTED", async () => {
    getConnectionMock.mockResolvedValueOnce({ status: "CONNECTED", account_identifier: "https://example.com", metadata: { username: "writer" } });
    getConnectionSecretMock.mockResolvedValueOnce("decrypted-app-password");

    const connector = await loadWordPressConnector(fakeAdmin, "user-1", "biz-1");
    expect(connector).toBeInstanceOf(WordPressConnector);
    expect(connector!.isConfigured()).toBe(true);
  });
});
