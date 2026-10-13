import "server-only";
import { getNaverBlogCollector, getTistoryCollector, getYouTubeDataProvider } from "./providers";
import { YouTubeCollectorError } from "./providers/youtube-types";
import { parseChannelUrl } from "./url-parser";
import type { ParsedChannelUrl } from "./url-parser";
import type { ChannelPlatform } from "./platform";

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
      const metrics = await getTistoryCollector()(parsed.normalizedUrl, now);
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
      const metrics = await getNaverBlogCollector()(parsed.externalId, undefined, now);
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
          note: verified ? null : "공개된 글이 보이지 않아요. RSS 공개가 꺼져 있거나 아직 글이 없다면 수집할 수 있는 지표가 없어요.",
        },
      };
    }
  }
}
