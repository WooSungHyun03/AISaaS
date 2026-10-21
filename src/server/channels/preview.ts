import "server-only";
import { getNaverBlogCollector, getTistoryCollector, getYouTubeDataProvider } from "./providers";
import { FeedTransientError } from "./providers/feed-failure";
import { YouTubeCollectorError } from "./providers/youtube-types";
import { parseChannelUrl } from "./url-parser";
import type { ParsedChannelUrl } from "./url-parser";
import type { ChannelPlatform } from "./platform";
import type { NaverBlogMetrics } from "./providers/naver-types";
import type { TistoryRssMetrics } from "./providers/tistory";

const UNREACHABLE_NOTE = "블로그에 지금 연결하지 못했어요. 등록은 할 수 있고, 매일 자동으로 다시 확인해요.";

/** What the registration form shows before anything is saved, so the owner can confirm it is the right channel. */
export interface ChannelPreview {
  platform: ChannelPlatform;
  /** The id a registration will store (a YouTube channel id "UC…" once resolved). */
  externalId: string;
  normalizedUrl: string;
  displayName: string | null;
  thumbnailUrl: string | null;
  /** One short line of public facts ("구독자 1,200명 · 영상 42개", "공개 글 8개 확인"). */
  summary: string | null;
  /** True when the public data could be read; false means "registered, but nothing can be measured yet" (a private or empty blog). */
  verified: boolean;
  /** Why it could not be verified, when verified is false. */
  note: string | null;
}

export type ChannelPreviewResult = { ok: true; preview: ChannelPreview } | { ok: false; message: string };

/** Naver blocks every crawler from its blog RSS (robots.txt), so a blog is only measurable through Naver search when the search keys exist and its posts show up there. */
export const NAVER_ROBOTS_BLOCKED_NOTE =
  "네이버 블로그는 RSS 자동 수집을 허용하지 않아 글 목록을 직접 읽지 않아요. 네이버 검색에서도 이 블로그의 글을 찾지 못해 지금은 측정할 수 있는 지표가 없어요. 등록은 할 수 있고, 검색에 글이 노출되면 그때부터 기록돼요.";

const NOT_FOUND_MESSAGE = "채널을 찾을 수 없어요. 주소를 확인하거나, 비공개·삭제된 채널은 등록할 수 없어요.";

/**
 * Resolves and verifies a channel address with public data only (no OAuth): YouTube through the official Data API
 * (1 quota unit), blogs through their public RSS. Used by the "확인" step of registration and by registration itself,
 * so what the owner confirmed is exactly what gets saved.
 */
export async function previewChannel(url: string, platformHint?: ChannelPlatform, now: Date = new Date()): Promise<ChannelPreviewResult> {
  const parsed = parseChannelUrl(url, platformHint);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  return resolveParsedChannel(parsed, now);
}

export async function resolveParsedChannel(parsed: Extract<ParsedChannelUrl, { ok: true }>, now: Date = new Date()): Promise<ChannelPreviewResult> {
  switch (parsed.platform) {
    case "youtube": {
      try {
        const lookup = parsed.youtubeLookup ?? { channelId: parsed.externalId };
        const channel = await getYouTubeDataProvider().lookup(lookup);
        const facts = [channel.subscriberCount !== null ? `구독자 ${channel.subscriberCount.toLocaleString("ko-KR")}명` : "구독자 수 비공개", `영상 ${channel.videoCount.toLocaleString("ko-KR")}개`];
        return {
          ok: true,
          preview: {
            platform: "youtube",
            externalId: channel.channelId,
            normalizedUrl: channel.handle ? `https://youtube.com/${channel.handle}` : `https://youtube.com/channel/${channel.channelId}`,
            displayName: channel.title,
            thumbnailUrl: channel.thumbnailUrl,
            summary: facts.join(" · "),
            verified: true,
            note: null,
          },
        };
      } catch (error) {
        if (error instanceof YouTubeCollectorError && error.code === "CHANNEL_NOT_FOUND") return { ok: false, message: NOT_FOUND_MESSAGE };
        throw error;
      }
    }
    case "tistory": {
      const metrics = await getTistoryCollector()(parsed.normalizedUrl, now).catch((error: unknown): TistoryRssMetrics => {
        // The blog could not be reached just now: it can still be registered, the daily collection tries again.
        if (!(error instanceof FeedTransientError)) throw error;
        return { posts: [], observedCapped: false, unavailableReason: UNREACHABLE_NOTE };
      });
      const verified = metrics.unavailableReason === null && metrics.posts.length > 0;
      return {
        ok: true,
        preview: {
          platform: "tistory",
          externalId: parsed.externalId,
          normalizedUrl: parsed.normalizedUrl,
          displayName: metrics.blogTitle ?? null,
          thumbnailUrl: null,
          summary: verified ? `공개 글 ${metrics.posts.length}개${metrics.observedCapped ? " 이상" : ""} 확인` : null,
          verified,
          note: verified ? null : (metrics.unavailableReason ?? "공개된 글이 보이지 않아요. 비공개이거나 아직 글이 없다면 수집할 수 있는 지표가 없어요."),
        },
      };
    }
    case "naver_blog": {
      const metrics: NaverBlogMetrics & { unreachable?: boolean } = await getNaverBlogCollector()(parsed.externalId, undefined, now).catch((error: unknown): NaverBlogMetrics & { unreachable?: boolean } => {
        if (!(error instanceof FeedTransientError)) throw error;
        return { matchedPostCount: 0, postsLast30Days: 0, averageGapDays: null, lastPostDate: null, firstPostDate: null, unreachable: true };
      });
      const verified = metrics.matchedPostCount > 0;
      return {
        ok: true,
        preview: {
          platform: "naver_blog",
          externalId: parsed.externalId,
          normalizedUrl: parsed.normalizedUrl,
          displayName: metrics.blogTitle ?? null,
          thumbnailUrl: null,
          summary: verified ? `공개 글 ${metrics.matchedPostCount}개 확인${metrics.lastPostDate ? ` · 마지막 글 ${metrics.lastPostDate}` : ""}` : null,
          verified,
          note: verified
            ? null
            : metrics.unreachable
              ? UNREACHABLE_NOTE
              : metrics.blockedByRobots
              ? NAVER_ROBOTS_BLOCKED_NOTE
              : "공개된 글이 보이지 않아요. RSS 공개가 꺼져 있거나 아직 글이 없다면 수집할 수 있는 지표가 없어요.",
        },
      };
    }
  }
}
