import type { ChannelPlatform } from "./platform";
import { channelPlatformSchema } from "./platform";

export type ParsedChannelUrl =
  | { ok: true; platform: ChannelPlatform; externalId: string; normalizedUrl: string }
  | { ok: false; message: string };

const UNSUPPORTED_MESSAGE =
  "지원하지 않는 채널 URL 형식이에요. 유튜브(@핸들 또는 /channel/UC...), 네이버 블로그(blog.naver.com/...), 티스토리(*.tistory.com) 중 하나를 입력하거나, 플랫폼을 직접 선택해주세요.";

/** Real YouTube channel ids always start with "UC" and are 24 chars total. */
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

function toUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

/** Strips one leading "www." or "m." label — both this project's naver/youtube mobile hosts use a single prefix label. */
function normalizeHost(host: string): string {
  return host.replace(/^(www\.|m\.)/, "");
}

function pathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

function parseYouTube(url: URL): ParsedChannelUrl {
  const segments = pathSegments(url);
  const first = segments[0] ?? "";

  if (first.startsWith("@") && first.length > 1) {
    return { ok: true, platform: "youtube", externalId: first, normalizedUrl: `https://youtube.com/${first}` };
  }

  if (first.toLowerCase() === "channel" && segments[1] && YOUTUBE_CHANNEL_ID.test(segments[1])) {
    const channelId = segments[1];
    return { ok: true, platform: "youtube", externalId: channelId, normalizedUrl: `https://youtube.com/channel/${channelId}` };
  }

  return {
    ok: false,
    message: "지원하지 않는 유튜브 URL 형식이에요. @핸들 또는 /channel/UC... 형식을 사용해주세요.",
  };
}

function parseNaverBlog(url: URL): ParsedChannelUrl {
  const blogIdParam = url.searchParams.get("blogId");
  if (blogIdParam) {
    return { ok: true, platform: "naver_blog", externalId: blogIdParam, normalizedUrl: `https://blog.naver.com/${blogIdParam}` };
  }

  const [blogId] = pathSegments(url);
  if (blogId) {
    return { ok: true, platform: "naver_blog", externalId: blogId, normalizedUrl: `https://blog.naver.com/${blogId}` };
  }

  return {
    ok: false,
    message: "네이버 블로그 주소 형식을 확인할 수 없어요. blog.naver.com/{블로그ID} 형식을 사용해주세요.",
  };
}

function parseTistory(host: string): ParsedChannelUrl {
  const subdomain = host.slice(0, -".tistory.com".length);
  if (!subdomain) {
    return {
      ok: false,
      message: "티스토리 블로그 이름을 확인할 수 없어요. {블로그이름}.tistory.com 형식을 사용해주세요.",
    };
  }
  return { ok: true, platform: "tistory", externalId: subdomain, normalizedUrl: `https://${subdomain}.tistory.com/` };
}

/**
 * Resolves a channel URL to its platform + a stable external id, without any
 * network I/O (pure function, synchronously testable — see diagnosis.ts's
 * `extractPageSignals` for the same design principle in this domain).
 *
 * `platformHint` exists for URLs this parser cannot classify by hostname
 * alone — most notably a Tistory blog on a custom domain, which is
 * indistinguishable from any other site by URL shape. When the hostname
 * doesn't match a known pattern but a caller supplies `platformHint` (the
 * user explicitly picking a platform in the UI — not built in this ticket),
 * the custom domain itself becomes the external id.
 */
export function parseChannelUrl(input: string, platformHint?: ChannelPlatform): ParsedChannelUrl {
  const url = toUrl(input);
  if (!url) return { ok: false, message: "올바른 URL 형식이 아니에요." };

  const host = normalizeHost(url.hostname.toLowerCase());

  if (host === "youtu.be") {
    return { ok: false, message: "youtu.be는 영상 링크예요. 채널 홈 URL을 입력해주세요." };
  }
  if (host === "youtube.com") return parseYouTube(url);
  if (host === "blog.naver.com") return parseNaverBlog(url);
  if (host.endsWith(".tistory.com")) return parseTistory(host);

  if (platformHint && channelPlatformSchema.safeParse(platformHint).success) {
    return { ok: true, platform: platformHint, externalId: host, normalizedUrl: `https://${host}/` };
  }

  return { ok: false, message: UNSUPPORTED_MESSAGE };
}
