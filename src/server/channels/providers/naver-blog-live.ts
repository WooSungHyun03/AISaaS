import "server-only";
import { serverEnv } from "@/lib/env/server";
import { collectNaverBlogMetrics } from "./naver-blog";
import { collectNaverBlogRssMetrics } from "./naver-blog-rss";
import type { NaverBlogCollector, NaverBlogMetrics } from "./naver-types";

/**
 * Live Naver Blog collector: the blog's own RSS first (real latest posts, no key). Only when the RSS
 * shows nothing and Naver search keys exist does it try blog *search*, which sees only posts that
 * mention the blog id — a weaker signal, so its result is labelled `basis: "search"`.
 */
export const collectNaverBlogLive: NaverBlogCollector = async (externalId, businessName, now = new Date()): Promise<NaverBlogMetrics> => {
  const fromRss = await collectNaverBlogRssMetrics(externalId, now);
  if (fromRss.matchedPostCount > 0) return fromRss;
  if (!serverEnv.NAVER_CLIENT_ID || !serverEnv.NAVER_CLIENT_SECRET) return fromRss;
  try {
    const fromSearch = await collectNaverBlogMetrics(externalId, businessName, now);
    return fromSearch.matchedPostCount > 0 ? { ...fromSearch, basis: "search" } : fromRss;
  } catch {
    // The search API is only a fallback; an outage or a bad key must not turn "no posts seen" into an error.
    return fromRss;
  }
};
