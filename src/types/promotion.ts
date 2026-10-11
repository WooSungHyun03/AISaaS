import { z } from "zod";

/**
 * What a business promotes. The three types ask different questions and get different blog posts and
 * Shorts; the answers live in the usual business columns, plus `promotion_details` for what has no column.
 */
export const PROMOTION_TYPES = ["STORE", "PRODUCT", "PLATFORM"] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export function isPromotionType(value: unknown): value is PromotionType {
  return typeof value === "string" && (PROMOTION_TYPES as readonly string[]).includes(value);
}

export const PROMOTION_LABEL: Record<PromotionType, string> = { STORE: "가게", PRODUCT: "상품", PLATFORM: "플랫폼" };

/** Extra answers with no business column of their own. Every field is optional and short. */
export const PROMOTION_DETAIL_LIMITS = { problem: 300, priceInfo: 200, actionUrl: 500, flow: 400 } as const;

export const promotionDetailsSchema = z.object({
  /** The problem the product / platform solves. */
  problem: z.string().trim().max(PROMOTION_DETAIL_LIMITS.problem).optional(),
  /** Price or promotion — only what the owner states. */
  priceInfo: z.string().trim().max(PROMOTION_DETAIL_LIMITS.priceInfo).optional(),
  /** Purchase URL (product) or sign-up URL (platform). */
  actionUrl: z.string().trim().max(PROMOTION_DETAIL_LIMITS.actionUrl).optional(),
  /** How people use the platform, step by step. */
  flow: z.string().trim().max(PROMOTION_DETAIL_LIMITS.flow).optional(),
});
export type PromotionDetails = z.infer<typeof promotionDetailsSchema>;

/** Reads the stored jsonb; anything unexpected is ignored rather than breaking a page. */
export function parsePromotionDetails(value: unknown): PromotionDetails {
  const parsed = promotionDetailsSchema.safeParse(value && typeof value === "object" && !Array.isArray(value) ? value : {});
  return parsed.success ? parsed.data : {};
}

export type PromotionFieldKey =
  | "name"
  | "industry"
  | "location"
  | "mainOffering"
  | "strengths"
  | "targetCustomer"
  | "website"
  | "problem"
  | "priceInfo"
  | "actionUrl"
  | "flow";

export interface PromotionFieldSpec {
  key: PromotionFieldKey;
  label: string;
  placeholder: string;
  /** Text area for longer answers. */
  long?: boolean;
  required?: boolean;
  /** `url` renders an URL input. */
  kind?: "url";
}

/** The questions per type, in the order they are asked. Labels and examples are what make the form feel specific. */
export const PROMOTION_FORM: Record<PromotionType, { title: string; hint: string; fields: PromotionFieldSpec[] }> = {
  STORE: {
    title: "가게 홍보",
    hint: "카페, 음식점, 헬스장, 미용실처럼 찾아오는 손님이 있는 곳",
    fields: [
      { key: "name", label: "상호명", placeholder: "예: 모닝 베이커리", required: true },
      { key: "industry", label: "업종", placeholder: "예: 카페, 헬스장, 미용실" },
      { key: "location", label: "지역·주소", placeholder: "예: 서울 성수동, 성수역 3번 출구 도보 5분" },
      { key: "mainOffering", label: "주요 서비스·메뉴", placeholder: "예: 수제 케이크, 단체 주문", long: true },
      { key: "strengths", label: "장점·차별점", placeholder: "예: 매일 아침 직접 구운 빵, 주차 가능", long: true },
      { key: "targetCustomer", label: "타깃 고객", placeholder: "예: 선물용 디저트를 찾는 20~30대 직장인", long: true },
      { key: "priceInfo", label: "가격·프로모션 (있다면)", placeholder: "예: 아메리카노 3,500원, 오픈 기념 10% 할인" },
      { key: "website", label: "홈페이지·예약 주소", placeholder: "https://", kind: "url" },
    ],
  },
  PRODUCT: {
    title: "상품 홍보",
    hint: "의류, 화장품, 식품, 전자제품처럼 사 가는 물건",
    fields: [
      { key: "name", label: "상품명", placeholder: "예: 수제 쑥 휘낭시에 세트", required: true },
      { key: "industry", label: "카테고리", placeholder: "예: 디저트, 의류, 화장품" },
      { key: "mainOffering", label: "주요 특징", placeholder: "예: 국산 쑥 사용, 개별 포장 6개입", long: true },
      { key: "problem", label: "해결하는 문제", placeholder: "예: 선물할 때 눅눅해지거나 포장이 허술한 디저트가 고민이에요", long: true },
      { key: "strengths", label: "핵심 장점", placeholder: "예: 당일 제작, 선물 포장 무료", long: true },
      { key: "priceInfo", label: "가격", placeholder: "예: 6개입 18,000원" },
      { key: "actionUrl", label: "구매 주소", placeholder: "https://", kind: "url" },
      { key: "targetCustomer", label: "타깃 고객", placeholder: "예: 선물용 디저트를 찾는 30~40대", long: true },
    ],
  },
  PLATFORM: {
    title: "플랫폼 홍보",
    hint: "웹서비스, 앱, SaaS처럼 가입해서 쓰는 서비스",
    fields: [
      { key: "name", label: "서비스명", placeholder: "예: 이지 마케팅", required: true },
      { key: "website", label: "홈페이지", placeholder: "https://", kind: "url" },
      { key: "mainOffering", label: "주요 기능", placeholder: "예: 블로그 글 자동 작성, 숏폼 영상 제작, 마케팅 캘린더", long: true },
      { key: "problem", label: "해결하는 문제", placeholder: "예: 사장님이 마케팅할 시간이 없어요", long: true },
      { key: "targetCustomer", label: "대상 사용자", placeholder: "예: 혼자 운영하는 소상공인", long: true },
      { key: "strengths", label: "차별점", placeholder: "예: 업종 정보만 넣으면 바로 결과가 나와요", long: true },
      { key: "flow", label: "주요 사용 흐름", placeholder: "예: 가게 정보 입력 → 주제 선택 → 글·영상 생성 → 확인 후 게시", long: true },
      { key: "actionUrl", label: "가입 주소", placeholder: "https://", kind: "url" },
    ],
  },
};

/** The call to action each type naturally ends with — the AI is told to use it, not to invent a different promise. */
export const PROMOTION_CTA: Record<PromotionType, string> = {
  STORE: "예약·방문·문의",
  PRODUCT: "구매하러 가기",
  PLATFORM: "무료로 시작하기·가입",
};
