import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPublicText } = vi.hoisted(() => ({ fetchPublicText: vi.fn() }));
vi.mock("@/server/marketing/diagnosis", async () => {
  class DiagnosisError extends Error {
    constructor(public code: string, message: string) { super(message); }
  }
  return { DiagnosisError, fetchPublicText };
});

import { DiagnosisError } from "@/server/marketing/diagnosis";
import { clearRobotsCacheForTests, isFetchAllowedByRobots, isPathAllowed, parseRobotsRules } from "./robots";

const fail = (code: string, message: string) => new (DiagnosisError as unknown as new (c: string, m: string) => Error)(code, message);

describe("parseRobotsRules / isPathAllowed (RFC 9309)", () => {
  it("applies the `*` group when there is no group for the collector", () => {
    const rules = parseRobotsRules("User-agent: *\nDisallow: /private\nAllow: /private/ok\n");
    expect(isPathAllowed(rules, "/rss")).toBe(true);
    expect(isPathAllowed(rules, "/private/a")).toBe(false);
    expect(isPathAllowed(rules, "/private/ok")).toBe(true); // the longer Allow wins
  });

  it("prefers the collector's own group over `*`", () => {
    const rules = parseRobotsRules("User-agent: *\nDisallow: /\n\nUser-agent: EasyMarketingDiagnosisBot\nAllow: /\n");
    expect(isPathAllowed(rules, "/rss")).toBe(true);
  });

  it("blocks everything for `Disallow: /` and supports * and $ patterns", () => {
    expect(isPathAllowed(parseRobotsRules("User-agent: *\nDisallow: /\n"), "/rss")).toBe(false);
    const rules = parseRobotsRules("User-agent: *\nDisallow: /*.xml$\n");
    expect(isPathAllowed(rules, "/blog.xml")).toBe(false);
    expect(isPathAllowed(rules, "/blog.xml?x=1")).toBe(true);
  });

  it("an empty Disallow allows everything, and comments are ignored", () => {
    expect(isPathAllowed(parseRobotsRules("User-agent: * # all\nDisallow: # nothing\n"), "/anything")).toBe(true);
  });
});

describe("isFetchAllowedByRobots", () => {
  beforeEach(() => {
    fetchPublicText.mockReset();
    clearRobotsCacheForTests();
  });

  it("allows the feed when robots.txt does not mention it, and caches the answer per origin", async () => {
    fetchPublicText.mockResolvedValue({ html: "User-agent: *\nDisallow: /admin\n", finalUrl: "" });
    expect(await isFetchAllowedByRobots("https://my.tistory.com/rss")).toBe(true);
    expect(await isFetchAllowedByRobots("https://my.tistory.com/rss")).toBe(true);
    expect(fetchPublicText).toHaveBeenCalledTimes(1);
    expect(fetchPublicText).toHaveBeenCalledWith("https://my.tistory.com/robots.txt");
  });

  it("refuses a feed the site disallows", async () => {
    fetchPublicText.mockResolvedValue({ html: "User-agent: *\nDisallow: /rss\n", finalUrl: "" });
    expect(await isFetchAllowedByRobots("https://my.tistory.com/rss")).toBe(false);
  });

  it("a missing robots.txt (404) allows everything", async () => {
    fetchPublicText.mockRejectedValue(fail("FETCH_FAILED", "페이지를 가져오지 못했습니다 (HTTP 404)."));
    expect(await isFetchAllowedByRobots("https://my.tistory.com/rss")).toBe(true);
  });

  it("a server error or unreachable robots.txt does not crawl, and is asked again next time", async () => {
    fetchPublicText.mockRejectedValue(fail("FETCH_FAILED", "페이지를 가져오지 못했습니다 (HTTP 503)."));
    expect(await isFetchAllowedByRobots("https://my.tistory.com/rss")).toBe(false);
    fetchPublicText.mockResolvedValue({ html: "", finalUrl: "" });
    expect(await isFetchAllowedByRobots("https://my.tistory.com/rss")).toBe(true);
    expect(fetchPublicText).toHaveBeenCalledTimes(2);
  });

  it("never reaches a private address even to read robots.txt", async () => {
    fetchPublicText.mockRejectedValue(fail("BLOCKED_TARGET", "blocked"));
    await expect(isFetchAllowedByRobots("https://127.0.0.1/rss")).rejects.toMatchObject({ code: "BLOCKED_TARGET" });
  });
});
