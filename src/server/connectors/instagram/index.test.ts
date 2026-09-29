import { afterEach, describe, expect, it, vi } from "vitest";
import { isConnectorError } from "@/server/shared/errors";

vi.mock("@/lib/env/server", () => ({
  serverEnv: { META_ACCESS_TOKEN: undefined, META_IG_USER_ID: undefined },
}));

const { InstagramConnector } = await import("./index");

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const CONNECTION = { accessToken: "ig-token", igUserId: "ig-user-1" };
const PUBLISH_PARAMS = { content: "오늘의 소식입니다 #홍보", imageUrl: "https://storage.example.com/marketing-card.png" };

describe("InstagramConnector.isConfigured", () => {
  it("is true when an explicit connection is given", () => {
    expect(new InstagramConnector(CONNECTION).isConfigured()).toBe(true);
  });

  it("is false with no connection and no env vars configured", () => {
    expect(new InstagramConnector().isConfigured()).toBe(false);
  });
});

describe("InstagramConnector.publish", () => {
  it("requires an imageUrl — never calls the API without one", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await new InstagramConnector(CONNECTION).publish({ content: "caption only" }).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("INVALID_TARGET");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws NOT_CONFIGURED without ever calling fetch when neither a connection nor env vars are set", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await new InstagramConnector().publish(PUBLISH_PARAMS).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("NOT_CONFIGURED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs the full container-create -> status-check -> media_publish sequence and returns the media id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "creation-1" })) // create container
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "FINISHED" })) // status check
      .mockResolvedValueOnce(jsonResponse(200, { id: "media-1" })); // publish
    vi.stubGlobal("fetch", fetchMock);

    const result = await new InstagramConnector(CONNECTION, { pollIntervalMs: 0 }).publish(PUBLISH_PARAMS);

    expect(result).toEqual({ externalId: "media-1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const createUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(createUrl.pathname).toBe("/v21.0/ig-user-1/media");
    expect(createUrl.searchParams.get("image_url")).toBe(PUBLISH_PARAMS.imageUrl);
    expect(createUrl.searchParams.get("caption")).toBe(PUBLISH_PARAMS.content);
    expect(createUrl.searchParams.get("access_token")).toBe("ig-token");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });

    const statusUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(statusUrl.pathname).toBe("/v21.0/creation-1");
    expect(statusUrl.searchParams.get("fields")).toBe("status_code");

    const publishUrl = new URL(fetchMock.mock.calls[2][0] as string);
    expect(publishUrl.pathname).toBe("/v21.0/ig-user-1/media_publish");
    expect(publishUrl.searchParams.get("creation_id")).toBe("creation-1");
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "POST" });
  });

  it("polls IN_PROGRESS status until FINISHED before publishing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "creation-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "IN_PROGRESS" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "IN_PROGRESS" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "media-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new InstagramConnector(CONNECTION, { pollIntervalMs: 0 }).publish(PUBLISH_PARAMS);

    expect(result).toEqual({ externalId: "media-1" });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("container creation failure (non-2xx) surfaces a classified ConnectorError and never polls or publishes", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(401, { error: "invalid token" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new InstagramConnector(CONNECTION).publish(PUBLISH_PARAMS).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("AUTH_FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an ERROR status_code stops polling and throws instead of ever calling media_publish", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "creation-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "ERROR" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new InstagramConnector(CONNECTION, { pollIntervalMs: 0 }).publish(PUBLISH_PARAMS).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("UPSTREAM_SERVER_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a container stuck IN_PROGRESS past the bounded attempt limit times out instead of polling forever", async () => {
    // mockImplementation (not mockResolvedValue) so every poll gets a fresh
    // Response — a Response body can only be read (json()) once.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "creation-1" }))
      .mockImplementation(() => Promise.resolve(jsonResponse(200, { status_code: "IN_PROGRESS" })));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new InstagramConnector(CONNECTION, { pollIntervalMs: 0 }).publish(PUBLISH_PARAMS).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("TIMEOUT");
    // 1 create + 5 bounded status checks, never more.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("a publish (media_publish) failure surfaces a classified ConnectorError after a successful container/status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { id: "creation-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse(500, { error: "internal" }));
    vi.stubGlobal("fetch", fetchMock);

    const error = await new InstagramConnector(CONNECTION, { pollIntervalMs: 0 }).publish(PUBLISH_PARAMS).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("UPSTREAM_SERVER_ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("classifies a timed-out request as TIMEOUT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }))),
    );

    const error = await new InstagramConnector(CONNECTION).publish(PUBLISH_PARAMS).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("TIMEOUT");
  });

  it("classifies a raw network failure as NETWORK_FAILURE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const error = await new InstagramConnector(CONNECTION).publish(PUBLISH_PARAMS).catch((e: unknown) => e);

    expect(isConnectorError(error)).toBe(true);
    expect((error as { code: string }).code).toBe("NETWORK_FAILURE");
  });
});
