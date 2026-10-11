import { decodeHtmlEntities } from "@/server/marketing/diagnosis";

/** CDATA와 일반 텍스트(HTML 엔티티 이스케이프) 두 형태 다 처리 — 실제 블로그는 스킨/플랫폼에 따라 둘 다 씁니다. */
export function extractTag(itemXml: string, tag: string): string | null {
  const cdata = itemXml.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, "i"));
  if (cdata) return decodeHtmlEntities(cdata[1]).trim() || null;
  const plain = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return plain ? decodeHtmlEntities(plain[1]).trim() || null : null;
}

/** RFC 822(pubDate) 텍스트만 뽑아 ISO 문자열로 변환 — 파싱 실패한 글은 조용히 건너뜀(크래시 대신). */
export function parsePubDate(raw: string | null): string | null {
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * The publish dates (newest first) of the first `maxItems` `<item>`s of an RSS feed.
 * `itemCount` is how many items the feed held in that window, so callers can tell "the feed is full"
 * from "this is everything". Only `<item>` blocks are read, so the channel's own `<pubDate>` is never counted.
 */
export function parseRssPublishDates(xml: string, maxItems: number): { dates: string[]; itemCount: number } {
  const blocks = Array.from(xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)).map((match) => match[1]);
  const dates = blocks
    .slice(0, maxItems)
    .map((block) => parsePubDate(extractTag(block, "pubDate")))
    .filter((publishedAt): publishedAt is string => publishedAt !== null)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return { dates, itemCount: blocks.length };
}
