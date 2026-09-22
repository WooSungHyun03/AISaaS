import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WordPressConnector, normalizeWordPressSiteUrl } from "./index";

const { httpsRequestMock } = vi.hoisted(() => ({ httpsRequestMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn().mockResolvedValue([{ address: "93.184.215.14", family: 4 }]) }));
vi.mock("node:https", () => ({ request: httpsRequestMock }));

afterEach(() => vi.clearAllMocks());

describe("WordPress connection", () => {
  it("accepts public HTTPS origins and rejects local or insecure targets", () => {
    expect(normalizeWordPressSiteUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeWordPressSiteUrl("https://example.com/blog/")).toBe("https://example.com/blog");
    expect(() => normalizeWordPressSiteUrl("http://example.com")).toThrow();
    expect(() => normalizeWordPressSiteUrl("https://127.0.0.1")).toThrow();
    expect(() => normalizeWordPressSiteUrl("https://example.com:8443")).toThrow();
  });

  it("checks credentials and sends the requested draft status to the validated address", async () => {
    const write = vi.fn();
    httpsRequestMock.mockImplementation((_url: string, _options: object, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200 });
      queueMicrotask(() => {
        callback(response);
        response.emit("data", Buffer.from(JSON.stringify({ id: 17, link: "https://example.com/?p=17" })));
        response.emit("end");
      });
      return { setTimeout: vi.fn(), on: vi.fn(), write, end: vi.fn(), destroy: vi.fn() };
    });

    const connector = new WordPressConnector({ siteUrl: "https://example.com", username: "writer", appPassword: "secret" });
    await connector.testConnection();
    const saved = await connector.publish({ title: "제목", content: "본문" }, "draft");

    expect(httpsRequestMock.mock.calls[0][0]).toBe("https://example.com/wp-json/wp/v2/users/me");
    expect(httpsRequestMock.mock.calls[1][1].lookup).toBeTypeOf("function");
    expect(JSON.parse(write.mock.calls[0][0])).toEqual({ title: "제목", content: "본문", status: "draft" });
    expect(saved.externalUrl).toBe("https://example.com/?p=17");
  });
});
