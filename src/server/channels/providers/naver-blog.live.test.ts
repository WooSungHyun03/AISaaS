import { describe, expect, it } from "vitest";
import { collectNaverBlogMetrics } from "./naver-blog";

/**
 * Manual, opt-in check against the real Naver Search API — mirrors
 * youtube.live.test.ts. Skipped by default (never hits the network from
 * `npm run test`/CI) unless BOTH are set:
 *
 *   NAVER_CLIENT_ID=... NAVER_CLIENT_SECRET=... RUN_LIVE_NAVER_TEST=true \
 *     npx vitest run src/server/channels/providers/naver-blog.live.test.ts
 *
 * Pass a real, public Naver blog id (and optionally its business name) via
 * env too, since there's no universally-stable public blog id to hardcode
 * the way youtube.live.test.ts hardcodes "@YouTube".
 */
const RUN_LIVE =
  process.env.RUN_LIVE_NAVER_TEST === "true" && Boolean(process.env.NAVER_CLIENT_ID) && Boolean(process.env.NAVER_CLIENT_SECRET) && Boolean(process.env.NAVER_LIVE_TEST_BLOG_ID);

describe.skipIf(!RUN_LIVE)("collectNaverBlogMetrics (live network)", () => {
  it("diagnoses a real public blog id from NAVER_LIVE_TEST_BLOG_ID", async () => {
    const result = await collectNaverBlogMetrics(process.env.NAVER_LIVE_TEST_BLOG_ID!, process.env.NAVER_LIVE_TEST_BUSINESS_NAME);
    expect(result.matchedPostCount).toBeGreaterThanOrEqual(0);
  }, 20_000);
});
