/**
 * A link stored under a channel name must actually point at that channel —
 * otherwise "https://example.com" saved as "Instagram" would count as a
 * connected channel in the marketing score.
 */
export const SNS_HOSTS = {
  instagram: ["instagram.com"],
  facebook: ["facebook.com", "fb.com"],
  youtube: ["youtube.com", "youtu.be"],
  naver_blog: ["blog.naver.com"],
  naver_place: ["map.naver.com", "place.naver.com", "naver.me"],
  kakao_channel: ["pf.kakao.com"],
} as const;

export type SnsLinkKey = keyof typeof SNS_HOSTS;

export const SNS_LABEL: Record<SnsLinkKey, string> = {
  instagram: "인스타그램",
  facebook: "페이스북",
  youtube: "유튜브",
  naver_blog: "네이버 블로그",
  naver_place: "네이버 플레이스",
  kakao_channel: "카카오톡 채널",
};

/** Returns a Korean error message, or null when the link is a valid http(s) URL on the channel's own domain. */
export function validateSnsLink(key: SnsLinkKey, value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${SNS_LABEL[key]} 링크 형식을 확인해주세요.`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `${SNS_LABEL[key]} 링크는 http 또는 https 주소로 입력해주세요.`;
  const host = url.hostname.toLowerCase();
  const allowed = SNS_HOSTS[key].some((domain) => host === domain || host.endsWith(`.${domain}`));
  return allowed ? null : `${SNS_LABEL[key]} 링크가 아니에요. ${SNS_HOSTS[key][0]} 주소를 입력해주세요.`;
}
