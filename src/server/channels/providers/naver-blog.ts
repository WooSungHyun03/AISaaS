import "server-only";
import { serverEnv } from "@/lib/env/server";
import { NaverCollectorError } from "./naver-types";
import type { NaverBlogMetrics } from "./naver-types";

const API_URL = "https://openapi.naver.com/v1/search/blog.json";
const REQUEST_TIMEOUT_MS = 10_000;
const DISPLAY = 100;
const MAX_START = 1000;
/** Hard budget for one diagnosis — enforced by checking this counter before every single call, so a 4th call can never happen regardless of how many pages/queries are tried. */
const MAX_CALLS = 3;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

/** KST calendar date (YYYY-MM-DD) for an instant — "오늘"의 기준은 KST. */
function kstDateString(timeMs: number): string {
  const kst = new Date(timeMs + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
}

interface BlogSearchItem {
  bloggerlink?: string;
  postdate?: string;
}

interface BlogSearchResponse {
  items?: BlogSearchItem[];
}

/** Strips protocol/www./m. prefixes and a trailing slash so "https://m.blog.naver.com/id/" and "blog.naver.com/id" compare equal. */
function normalizeBloggerLink(link: string): string {
  return link
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^(www\.|m\.)/, "")
    .replace(/\/$/, "");
}

function bloggerLinkMatches(link: string | undefined, externalId: string): boolean {
  if (!link) return false;
  const normalized = normalizeBloggerLink(link);
  const id = externalId.toLowerCase();
  return normalized === `blog.naver.com/${id}` || normalized === id;
}

/** "20251014" -> "2025-10-14". postdate has no time component — Naver reports it as a KST-local date already. */
function parsePostDate(postdate: string | undefined): string | null {
  if (!postdate) return null;
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(postdate);
  if (!match) return null;
  const [, year, month, day] = match;
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${month}-${day}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.abs(Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / DAY_MS;
}

async function searchOnePage(query: string, start: number, headers: Record<string, string>): Promise<BlogSearchItem[]> {
  const url = new URL(API_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(DISPLAY));
  url.searchParams.set("start", String(start));
  url.searchParams.set("sort", "date");

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
  } catch (cause) {
    if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
      throw new NaverCollectorError("UNKNOWN", "네이버 검색 API 응답이 시간 초과됐습니다.", { cause });
    }
    throw new NaverCollectorError("UNKNOWN", "네이버 검색 API에 연결하지 못했습니다.", { cause });
  }

  if (response.status === 429) throw new NaverCollectorError("RATE_LIMITED", "네이버 검색 API 호출 한도를 초과했습니다.");
  if (response.status === 401) throw new NaverCollectorError("INVALID_CREDENTIALS", "NAVER_CLIENT_ID/SECRET이 올바르지 않습니다.");
  if (!response.ok) throw new NaverCollectorError("UNKNOWN", `네이버 검색 API 요청이 실패했습니다 (HTTP ${response.status}).`);

  let body: BlogSearchResponse;
  try {
    body = (await response.json()) as BlogSearchResponse;
  } catch (cause) {
    throw new NaverCollectorError("INVALID_RESPONSE", "네이버 검색 API 응답 형식을 확인할 수 없습니다.", { cause });
  }
  if (!Array.isArray(body.items)) {
    throw new NaverCollectorError("INVALID_RESPONSE", "네이버 검색 API 응답 형식을 확인할 수 없습니다.");
  }
  return body.items;
}

function fromMetrics(dates: string[]): NaverBlogMetrics {
  if (dates.length === 0) return { matchedPostCount: 0, postsLast30Days: 0, averageGapDays: null, lastPostDate: null, firstPostDate: null };

  const sorted = [...dates].sort().reverse(); // "YYYY-MM-DD" sorts lexically == chronologically
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) gaps.push(daysBetween(sorted[i], sorted[i + 1]));
  const averageGapDays = gaps.length > 0 ? gaps.reduce((sum, g) => sum + g, 0) / gaps.length : null;

  return {
    matchedPostCount: sorted.length,
    postsLast30Days: 0, // filled in by the caller, which has `now`
    averageGapDays,
    lastPostDate: sorted[0],
    firstPostDate: sorted[sorted.length - 1],
  };
}

/**
 * Searches blog.json for `externalId` (and, if different, `businessName`)
 * and keeps only items whose `bloggerlink` matches the tracked blog — a
 * same-named blogger's unrelated posts are filtered out, not counted.
 * Never makes more than MAX_CALLS requests total across both queries.
 */
export async function collectNaverBlogMetrics(externalId: string, businessName: string | undefined, now: Date = new Date()): Promise<NaverBlogMetrics> {
  const clientId = serverEnv.NAVER_CLIENT_ID;
  const clientSecret = serverEnv.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new NaverCollectorError("INVALID_CREDENTIALS", "NAVER_CLIENT_ID/SECRET이 설정되지 않았습니다.");
  const headers = { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret };

  const queries = [externalId, ...(businessName && businessName.trim() && businessName !== externalId ? [businessName] : [])];
  let calls = 0;
  const matchedDates: string[] = [];

  for (const query of queries) {
    if (calls >= MAX_CALLS) break;
    let start = 1;
    const beforeThisQuery = matchedDates.length;

    while (calls < MAX_CALLS) {
      const items = await searchOnePage(query, start, headers);
      calls++;

      for (const item of items) {
        if (!bloggerLinkMatches(item.bloggerlink, externalId)) continue;
        const date = parsePostDate(item.postdate);
        if (date) matchedDates.push(date);
      }

      if (items.length < DISPLAY) break; // this query has no more pages
      start += DISPLAY;
      if (start > MAX_START) break;
    }

    if (matchedDates.length > beforeThisQuery) break; // found the right blog; no need to try the other query text
  }

  const metrics = fromMetrics(matchedDates);
  const todayKst = kstDateString(now.getTime());
  metrics.postsLast30Days = matchedDates.filter((date) => date <= todayKst && daysBetween(date, todayKst) < 30).length;
  return metrics;
}
