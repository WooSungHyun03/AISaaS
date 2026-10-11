import "server-only";
import { DiagnosisError, fetchPublicXml } from "@/server/marketing/diagnosis";
import { NaverCollectorError } from "./naver-types";
import type { NaverBlogMetrics } from "./naver-types";
import { parseRssPublishDates } from "./rss";

/**
 * A Naver blog's public RSS (`rss.blog.naver.com/{id}.xml`) lists the blog's own latest posts with
 * their publish times — no API key, and unlike blog *search* it is not limited to posts that happen
 * to contain the blog id. It is not a documented API, so every failure degrades to "no posts seen"
 * instead of throwing (only SSRF-blocked targets and invalid ids are errors).
 */
const MAX_ITEMS = 50;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;
const BLOG_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

function kstDate(timeMs: number): string {
  return new Date(timeMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;
}

export async function collectNaverBlogRssMetrics(externalId: string, now: Date = new Date()): Promise<NaverBlogMetrics> {
  if (!BLOG_ID_PATTERN.test(externalId)) throw new NaverCollectorError("INVALID_RESPONSE", "네이버 블로그 주소에서 아이디를 확인할 수 없어요.");

  let xml: string;
  try {
    xml = (await fetchPublicXml(`https://rss.blog.naver.com/${externalId}.xml`)).html;
  } catch (cause) {
    if (cause instanceof DiagnosisError && (cause.code === "BLOCKED_TARGET" || cause.code === "INVALID_URL")) throw cause;
    return emptyMetrics();
  }

  const { dates } = parseRssPublishDates(xml, MAX_ITEMS);
  if (dates.length === 0) return emptyMetrics();

  // Naver reports +09:00 times; the KST calendar date is what the score is about.
  const days = dates.map((iso) => kstDate(Date.parse(iso))); // newest first
  const gaps: number[] = [];
  for (let i = 0; i < days.length - 1; i++) gaps.push(daysBetween(days[i], days[i + 1]));
  const today = kstDate(now.getTime());

  return {
    matchedPostCount: days.length,
    postsLast30Days: days.filter((day) => day <= today && daysBetween(day, today) < 30).length,
    averageGapDays: gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null,
    lastPostDate: days[0],
    firstPostDate: days[days.length - 1],
    basis: "rss",
  };
}

function emptyMetrics(): NaverBlogMetrics {
  return { matchedPostCount: 0, postsLast30Days: 0, averageGapDays: null, lastPostDate: null, firstPostDate: null, basis: "rss" };
}
