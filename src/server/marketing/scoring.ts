import { z } from "zod";
import type { BusinessSnsLinks } from "@/types/domain";

/**
 * Marketing Score rubric. The score is computed here, in code, from signals
 * measured on the fetched page and the saved business profile — never asked
 * of the AI — so the same page always gets the same score and every point
 * can be explained to the user (see `ScoreItem.detail`).
 *
 * Pure functions on purpose: no I/O, trivially unit-testable.
 */

export type ChannelKey = "instagram" | "youtube" | "naver_blog" | "naver_place" | "kakao_channel" | "facebook";

/** Channels worth having for a Korean small business, in the order they're suggested. */
export const CORE_CHANNELS: ChannelKey[] = ["instagram", "naver_blog", "naver_place", "youtube", "kakao_channel"];

export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  instagram: "인스타그램",
  youtube: "유튜브",
  naver_blog: "네이버 블로그",
  naver_place: "네이버 플레이스",
  kakao_channel: "카카오톡 채널",
  facebook: "페이스북",
};

export interface PageSignals {
  isHttps: boolean;
  title: string | null;
  metaDescription: string | null;
  hasViewport: boolean;
  hasLang: boolean;
  hasOpenGraph: boolean;
  h1Count: number;
  subheadingCount: number;
  /** Visible text length before it is truncated for the AI prompt. */
  textLength: number;
  hasContactInfo: boolean;
  hasCtaWording: boolean;
  /** Most recent plausible date found in the page, as epoch ms. */
  latestDateMs: number | null;
  hasPostSignal: boolean;
  snsLinks: BusinessSnsLinks;
}

export interface ScoreItem {
  key: string;
  group: "website" | "content" | "contact" | "channels" | "freshness";
  label: string;
  points: number;
  max: number;
  /** One Korean sentence saying what was found (or not). Shown to the user as the reason. */
  detail: string;
}

/** Validates a stored `score_breakdown` jsonb before it is rendered. */
export const scoreItemsSchema = z.array(
  z.object({
    key: z.string(),
    group: z.enum(["website", "content", "contact", "channels", "freshness"]),
    label: z.string(),
    points: z.number(),
    max: z.number(),
    detail: z.string(),
  }),
);

export const GROUP_LABEL: Record<ScoreItem["group"], string> = {
  website: "홈페이지 기본",
  content: "콘텐츠",
  contact: "연락·행동 유도",
  channels: "채널",
  freshness: "최근 업데이트",
};

export interface ScoreResult {
  score: number;
  items: ScoreItem[];
  /** Core channels that were not found anywhere (site links, saved profile, connected accounts). */
  missingChannels: ChannelKey[];
  presentChannels: ChannelKey[];
}

const DAY_MS = 86_400_000;

function item(group: ScoreItem["group"], key: string, label: string, ok: boolean | number, max: number, found: string, missing: string): ScoreItem {
  const points = typeof ok === "number" ? Math.max(0, Math.min(max, Math.round(ok))) : ok ? max : 0;
  return { key, group, label, points, max, detail: points >= max ? found : points > 0 ? `${found} (일부만 충족)` : missing };
}

/** Channels the business demonstrably has: links on its own site, links saved on its profile, or connected accounts. */
export function collectPresentChannels(siteLinks: BusinessSnsLinks, profileLinks: BusinessSnsLinks, connected: string[] = []): ChannelKey[] {
  const present = new Set<ChannelKey>();
  for (const links of [siteLinks, profileLinks]) {
    for (const key of Object.keys(CHANNEL_LABEL) as ChannelKey[]) {
      if (links[key]) present.add(key);
    }
    // Pre-`naver_blog` profiles stored a generic `blog` link.
    if (links.blog) present.add("naver_blog");
  }
  for (const provider of connected) {
    if (provider === "instagram" || provider === "youtube") present.add(provider);
  }
  return (Object.keys(CHANNEL_LABEL) as ChannelKey[]).filter((key) => present.has(key));
}

export function scoreMarketingSignals(
  signals: PageSignals,
  options: { profileSnsLinks?: BusinessSnsLinks; connectedProviders?: string[]; now?: Date } = {},
): ScoreResult {
  const now = (options.now ?? new Date()).getTime();
  const titleLength = signals.title?.length ?? 0;
  const descriptionLength = signals.metaDescription?.length ?? 0;

  const presentChannels = collectPresentChannels(signals.snsLinks, options.profileSnsLinks ?? {}, options.connectedProviders);
  const corePresent = CORE_CHANNELS.filter((channel) => presentChannels.includes(channel));
  const missingChannels = CORE_CHANNELS.filter((channel) => !presentChannels.includes(channel));

  const ageDays = signals.latestDateMs === null ? null : (now - signals.latestDateMs) / DAY_MS;
  const freshnessPoints =
    ageDays !== null && ageDays <= 30 ? 20 : ageDays !== null && ageDays <= 90 ? 12 : ageDays !== null && ageDays <= 365 ? 5 : signals.hasPostSignal ? 6 : 0;
  const freshnessDetail =
    ageDays === null
      ? signals.hasPostSignal ? "게시물 영역은 있지만 날짜를 확인할 수 없어요." : "홈페이지에서 최근 게시물이나 날짜를 찾지 못했어요."
      : `홈페이지에서 가장 최근 날짜가 약 ${Math.max(0, Math.round(ageDays))}일 전이에요.`;

  const items: ScoreItem[] = [
    item("website", "https", "보안 연결(HTTPS)", signals.isHttps, 5, "HTTPS로 접속돼요.", "HTTPS가 아니라서 브라우저가 '안전하지 않음'으로 표시할 수 있어요."),
    item("website", "title", "페이지 제목", titleLength >= 8 && titleLength <= 70, 5, `제목이 적당해요 (${titleLength}자).`, titleLength === 0 ? "페이지 제목이 없어요." : `제목 길이가 ${titleLength}자예요. 8~70자가 검색 결과에 잘 보여요.`),
    item("website", "description", "검색 결과 설명", descriptionLength >= 30 && descriptionLength <= 200, 5, `검색 결과용 설명이 있어요 (${descriptionLength}자).`, descriptionLength === 0 ? "검색 결과에 보일 설명(meta description)이 없어요." : `설명이 ${descriptionLength}자예요. 30~200자가 알맞아요.`),
    item("website", "mobile", "모바일 화면 대응", signals.hasViewport, 5, "모바일 화면 설정이 있어요.", "모바일 화면 설정(viewport)을 찾지 못했어요."),
    item("website", "h1", "대표 제목(H1)", signals.h1Count === 1 ? 5 : signals.h1Count > 1 ? 2 : 0, 5, "대표 제목이 한 개 있어요.", signals.h1Count === 0 ? "대표 제목(H1)이 없어요." : `대표 제목이 ${signals.h1Count}개예요. 한 개만 두는 게 좋아요.`),

    item("content", "content-length", "본문 분량", signals.textLength >= 1000 ? 8 : signals.textLength >= 300 ? 4 : 0, 8, `본문이 충분해요 (약 ${signals.textLength.toLocaleString()}자).`, `본문이 약 ${signals.textLength.toLocaleString()}자예요. 300자 이상은 있어야 검색에 잡혀요.`),
    item("content", "structure", "소제목 구성", signals.subheadingCount >= 2, 4, `소제목이 ${signals.subheadingCount}개 있어요.`, "소제목(H2·H3)으로 내용을 나눠 두지 않았어요."),
    item("content", "share-preview", "공유 미리보기", signals.hasOpenGraph && signals.hasLang, 3, "링크를 공유할 때 보일 미리보기 설정이 있어요.", "링크 공유 미리보기(Open Graph)나 언어 설정이 비어 있어요."),

    item("contact", "contact", "연락처·위치", signals.hasContactInfo, 10, "전화·이메일·주소 같은 연락 정보가 보여요.", "전화번호, 이메일, 주소 중 어느 것도 찾지 못했어요."),
    item("contact", "cta", "행동 유도 문구", signals.hasCtaWording, 10, "문의·예약·상담 같은 행동 유도 문구가 있어요.", "'문의하기', '예약하기' 같은 다음 행동을 안내하는 문구가 없어요."),

    item("channels", "channels", "채널 연결", corePresent.length >= 3 ? 20 : corePresent.length === 2 ? 14 : corePresent.length === 1 ? 8 : 0, 20,
      `${corePresent.map((channel) => CHANNEL_LABEL[channel]).join(", ")} 채널을 확인했어요.`,
      corePresent.length === 0 ? "홈페이지·사업 정보·연결된 계정 어디에서도 SNS 채널을 찾지 못했어요." : `${corePresent.map((channel) => CHANNEL_LABEL[channel]).join(", ")} 채널만 확인했어요. 3개 이상이면 만점이에요.`),

    item("freshness", "freshness", "최근 업데이트", freshnessPoints, 20, freshnessDetail, freshnessDetail),
  ];

  const score = items.reduce((total, entry) => total + entry.points, 0);
  return { score, items, missingChannels, presentChannels };
}

const WEIGHTED_ITEM_RECOMMENDATION: Record<string, string> = {
  https: "사이트 주소를 HTTPS로 바꿔 주세요. 호스팅 업체에서 무료 인증서를 켤 수 있어요.",
  title: "페이지 제목을 업종과 지역이 드러나는 8~70자 문장으로 다듬어 보세요.",
  description: "검색 결과에 보일 한두 문장 설명(meta description)을 30~200자로 추가해 보세요.",
  mobile: "휴대폰에서 보기 좋게 모바일 화면 설정(viewport)을 추가해 주세요.",
  h1: "페이지마다 대표 제목(H1)을 한 개만 두고 핵심 키워드를 넣어 보세요.",
  "content-length": "서비스 소개, 가격, 자주 묻는 질문처럼 손님이 궁금해할 내용을 더 적어 보세요.",
  structure: "소제목으로 내용을 나눠 읽기 쉽게 만들어 보세요.",
  "share-preview": "링크를 공유했을 때 사진과 제목이 보이도록 Open Graph 설정을 추가해 보세요.",
  contact: "전화번호, 이메일, 찾아오는 길을 눈에 띄는 곳에 적어 주세요.",
  cta: "'지금 문의하기', '예약하기'처럼 다음에 할 일을 알려 주는 버튼을 넣어 보세요.",
  freshness: "새 소식이나 블로그 글을 올려 사이트가 살아 있다는 걸 보여 주세요. 날짜도 함께 적으면 좋아요.",
};

/**
 * Concrete, rule-based recommendations for every item that lost points —
 * biggest point loss first. These always exist, even if the AI is down.
 */
export function buildRuleBasedRecommendations(result: ScoreResult, limit = 5): string[] {
  const recommendations: Array<{ lost: number; text: string }> = [];
  for (const entry of result.items) {
    const lost = entry.max - entry.points;
    if (lost <= 0) continue;
    if (entry.key === "channels") {
      const next = result.missingChannels.slice(0, 2).map((channel) => CHANNEL_LABEL[channel]);
      if (next.length > 0) recommendations.push({ lost, text: `${next.join(", ")} 채널을 만들고 홈페이지에 링크해 주세요.` });
      continue;
    }
    const text = WEIGHTED_ITEM_RECOMMENDATION[entry.key];
    if (text) recommendations.push({ lost, text });
  }
  return recommendations.sort((a, b) => b.lost - a.lost).slice(0, limit).map((entry) => entry.text);
}

export function describeFreshness(signals: Pick<PageSignals, "latestDateMs" | "hasPostSignal">, now: Date = new Date()): string {
  if (signals.latestDateMs === null) {
    return signals.hasPostSignal
      ? "홈페이지에 게시물 영역은 있지만 날짜가 없어 언제 갱신됐는지 알 수 없어요."
      : "홈페이지에서 최근 게시물이나 날짜를 찾지 못했어요. 새 소식을 올리고 있는지 확인이 필요해요.";
  }
  const days = Math.max(0, Math.round((now.getTime() - signals.latestDateMs) / DAY_MS));
  if (days <= 30) return `홈페이지의 가장 최근 날짜가 ${days}일 전이라 꾸준히 갱신되고 있어요.`;
  if (days <= 180) return `홈페이지의 가장 최근 날짜가 약 ${days}일 전이에요. 한동안 새 소식이 없었어요.`;
  return `홈페이지의 가장 최근 날짜가 약 ${days}일 전이에요. 오랫동안 갱신되지 않은 것으로 보여요.`;
}

/** The part of "SNS activity" that cannot be known without an official API — stated plainly instead of invented. */
export function describeSnsActivity(presentChannels: ChannelKey[], connectedProviders: string[] = []): string {
  if (presentChannels.length === 0) {
    return "홈페이지와 사업 정보에서 SNS 채널을 찾지 못했어요.";
  }
  const names = presentChannels.map((channel) => CHANNEL_LABEL[channel]).join(", ");
  const connected = connectedProviders.filter((provider) => provider === "instagram" || provider === "youtube");
  const connectedNote = connected.length ? ` ${connected.map((provider) => (provider === "instagram" ? "인스타그램" : "유튜브")).join(", ")}은 계정이 연결돼 있어요.` : "";
  return `${names} 채널을 확인했어요.${connectedNote} 게시물 수와 활동 빈도는 공식 계정 연결 없이는 확인할 수 없어서 점수에 넣지 않았어요.`;
}
