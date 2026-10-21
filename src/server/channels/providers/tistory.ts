import "server-only";
import { DiagnosisError, fetchPublicXml } from "@/server/marketing/diagnosis";
import { ROBOTS_DISALLOWED_REASON, isFetchAllowedByRobots } from "./robots";
import { FeedTransientError, classifyFeedFailure } from "./feed-failure";
import type { DiagnosisErrorCode } from "@/server/marketing/diagnosis";
import { parseRssChannelTitle, parseRssItems, parseRssPublishDates } from "./rss";

/**
 * ⚠️ 비공식 경로: 티스토리는 `/rss`를 공식 API로 문서화하지 않습니다 — URL 구조나
 * 응답 형식이 플랫폼 쪽에서 언제든 바뀌거나 막힐 수 있어요. 그래서 이 모듈은
 * "실패하면 예외를 던지는 대신 INSUFFICIENT_DATA로 안전하게 내려간다"는 원칙을
 * 지킵니다(SSRF 차단/잘못된 URL만 예외) — tistory-scoring.ts가 그 신호를 읽습니다.
 */
const MAX_ITEMS = 30;

/** Shared by the live collector below and tistory-mock.ts's sample, so providers/index.ts can switch between them. */
export type TistoryCollector = (blogUrl: string, now?: Date) => Promise<TistoryRssMetrics>;

export interface TistoryRssMetrics {
  /** 최신순, 최대 30개. */
  posts: Array<{ publishedAt: string; title?: string | null; url?: string | null }>;
  /** 피드가 정확히 MAX_ITEMS개로 꽉 찼다 — "관측된 글 기준"으로 표시해야 함. */
  observedCapped: boolean;
  /** The blog's own name from its feed, when the feed has one. */
  blogTitle?: string | null;
  /** null이 아니면 posts는 비어 있고, 이 문자열이 사유(비공개/404/형식오류 등). */
  unavailableReason: string | null;
  /** Why nothing could be measured, as a stable code for the collection log and the owner's message. */
  unavailableCode?: "ROBOTS_DISALLOWED" | "FEED_NOT_FOUND" | "FEED_FORBIDDEN" | "FEED_FORMAT";
}

function describeUnavailable(code: DiagnosisErrorCode): string {
  switch (code) {
    case "UNSUPPORTED_CONTENT":
      return "RSS 응답 형식을 확인할 수 없어요.";
    case "TOO_LARGE":
      return "RSS 응답이 너무 커서 처리할 수 없어요.";
    case "TOO_MANY_REDIRECTS":
      return "RSS 주소가 리다이렉트를 너무 많이 거쳐요.";
    default:
      return "RSS를 가져올 수 없어요 (비공개로 설정됐거나 찾을 수 없어요).";
  }
}

/**
 * `{blogUrl}/rss`를 가져와 최근 글(최대 30개)의 날짜만 추출합니다. 비공개·404·
 * 접근 차단·형식 오류는 전부 `unavailableReason`이 채워진 정상 결과로 돌아옵니다
 * (예외 아님) — SSRF 차단(`BLOCKED_TARGET`)과 잘못된 URL(`INVALID_URL`)만 예외로
 * 올립니다.
 */
export async function collectTistoryRssMetrics(blogUrl: string): Promise<TistoryRssMetrics> {
  const rssUrl = new URL("/rss", blogUrl).toString();

  let xml: string;
  try {
    // robots.txt first: a blog that does not allow automated reads is shown as "cannot be measured", never read anyway.
    if (!(await isFetchAllowedByRobots(rssUrl))) return { posts: [], observedCapped: false, unavailableReason: ROBOTS_DISALLOWED_REASON, unavailableCode: "ROBOTS_DISALLOWED" };
    xml = (await fetchPublicXml(rssUrl)).html;
  } catch (cause) {
    if (cause instanceof DiagnosisError) {
      if (cause.code === "BLOCKED_TARGET" || cause.code === "INVALID_URL") throw cause;
      const failure = classifyFeedFailure(cause);
      // A timeout, a 429 or a 5xx says nothing about the blog: report it as a failed attempt (retried with a back-off),
      // not as "this blog has no data".
      if (failure.kind === "TRANSIENT") throw new FeedTransientError(`티스토리 RSS에 지금 연결하지 못했어요${failure.status ? ` (HTTP ${failure.status})` : ""}.`, failure.retryAfterMs, { cause });
      if (failure.kind === "NOT_FOUND") return { posts: [], observedCapped: false, unavailableReason: "블로그 주소를 찾을 수 없어요(404). 주소가 맞는지 확인해주세요.", unavailableCode: "FEED_NOT_FOUND" };
      if (failure.kind === "FORBIDDEN") return { posts: [], observedCapped: false, unavailableReason: "블로그가 비공개이거나 RSS 접근을 막고 있어요.", unavailableCode: "FEED_FORBIDDEN" };
      return { posts: [], observedCapped: false, unavailableReason: describeUnavailable(cause.code as DiagnosisErrorCode), unavailableCode: "FEED_FORMAT" };
    }
    throw cause;
  }

  const { dates, itemCount } = parseRssPublishDates(xml, MAX_ITEMS);
  const items = parseRssItems(xml, MAX_ITEMS);
  const byDate = new Map(items.map((item) => [item.publishedAt, item]));
  return {
    posts: dates.map((publishedAt) => ({ publishedAt, title: byDate.get(publishedAt)?.title ?? null, url: byDate.get(publishedAt)?.link ?? null })),
    observedCapped: itemCount >= MAX_ITEMS,
    blogTitle: parseRssChannelTitle(xml),
    unavailableReason: null,
  };
}
