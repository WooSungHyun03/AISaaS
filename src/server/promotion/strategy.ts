import type { Business } from "@/types/domain";
import { promotionFieldValue } from "@/lib/promotion";
import { PROMOTION_CTA, PROMOTION_LABEL, type PromotionType } from "@/types/promotion";

/**
 * How each kind of promotion is planned. A prompt that only swaps a noun would write the same post for a cafe, a
 * lipstick and a SaaS; these are the parts that really differ — what the reader wants, which angle earns the click,
 * which beats the piece needs, what must not be claimed, and how a Short is staged.
 */
export interface PromotionStrategy {
  /** What the person who finds this wants to get done. */
  searchIntent: string;
  /** Angles a post (or a Short) can take; one is picked per piece so posts stay varied. */
  angles: string[];
  /** The beats a blog post should cover, in order — chosen from the facts that exist. */
  blogBeats: string[];
  /** How the post ends. */
  ctaStyle: string;
  /** Claims that are risky for this kind of promotion on top of the general ones. */
  claimRules: string[];
  /** A Short's storyline, hook to call to action. */
  shortsBeats: string[];
  /** Ways to open a Short. */
  hookStyles: string[];
  /** What the footage should be built from. */
  visuals: string;
  /** Closing card label of a Short. */
  closingLabel: string;
}

export const PROMOTION_STRATEGY: Record<PromotionType, PromotionStrategy> = {
  STORE: {
    searchIntent: "근처에서 괜찮은 곳을 찾아, 가도 될지 확신하고 싶은 사람 (지역명 + 업종 검색)",
    angles: ["처음 방문하는 사람을 위한 이용 안내", "이런 고민이 있을 때 이 가게를 찾는 이유", "하루 중 이 가게의 가장 좋은 시간", "메뉴·서비스를 고르는 방법", "이 지역에서 이 가게를 고르는 기준"],
    blogBeats: ["지역·상황을 짚는 도입(어떤 때 이곳을 찾게 되는지)", "손님이 가진 고민과 이 가게의 해결 방식", "공간·분위기와 이용 경험(장면 묘사)", "대표 메뉴·서비스를 고르는 법", "믿을 수 있는 이유(운영 방식·재료·정성 — 제공된 사실만)", "찾아오는 길·예약·문의 안내"],
    ctaStyle: "예약, 방문, 문의 중 사실로 확인되는 한 가지로 부드럽게 마무리",
    claimRules: ["영업시간·휴무일·주차·대기 여부는 제공된 정보에만 있을 때 쓴다", "'맛집', '핫플', '줄 서는 가게' 같은 평가는 사실이 아니면 쓰지 않는다"],
    shortsBeats: ["동네·고객 상황을 짚는 한 문장 훅", "매장·메뉴를 보여주는 장면", "이용하는 모습과 분위기", "방문·예약 안내"],
    hookStyles: ["이 동네에서 ○○ 찾고 있다면", "퇴근길에 딱 한 곳만 간다면", "처음 오는 분들이 가장 많이 묻는 것"],
    visuals: "매장 외관·내부·메뉴·결과물 사진이 가장 설득력 있다. 사진이 없으면 꾸민 장면 대신 이름과 지역이 보이는 카드로 대신한다.",
    closingLabel: "방문·예약",
  },
  PRODUCT: {
    searchIntent: "문제를 해결할 물건을 찾아, 이게 맞는지 비교하고 사도 될지 결정하려는 사람",
    angles: ["이런 고민이 있다면 (문제 → 해결)", "이 상품을 쓰는 장면과 사용법", "특징을 고객이 얻는 가치로 풀어쓰기", "고를 때 확인할 기준", "이런 분께 맞고 이런 분께는 맞지 않아요"],
    blogBeats: ["고객이 겪는 문제를 구체적 장면으로", "그 문제를 이 상품이 푸는 방식", "실제로 쓰는 장면과 사용법", "특징 → 고객이 얻는 가치(특징 나열 금지)", "고를 때 확인할 점과 맞는 사람", "구매 방법 안내"],
    ctaStyle: "구매 주소가 있으면 그곳으로, 없으면 문의 방법으로 안내",
    claimRules: ["효능·효과·치료·다이어트·피부 개선 같은 단정은 제공된 사실에 없으면 쓰지 않는다", "후기·판매량·순위·재구매율·'많은 분들이 만족'은 만들어내지 않는다", "가격·할인·무료배송은 제공된 정보에 있을 때만 쓴다", "다른 제품과의 비교는 사실이 주어졌을 때만 쓴다"],
    shortsBeats: ["문제를 건드리는 훅", "상품을 쓰는 장면(시연)", "핵심 장점 한 가지", "구매 안내"],
    hookStyles: ["이런 불편, 아직도 참고 계세요?", "이거 하나로 달라진 점", "사기 전에 이것만 확인하세요"],
    visuals: "상품 사진과 사용 장면이 핵심이다. 상품 모양이 바뀌는 생성 영상보다 원본 사진을 살린 움직임이 안전하다.",
    closingLabel: "구매하기",
  },
  PLATFORM: {
    searchIntent: "지금 하는 일이 번거로워 도구를 찾다가, 이 서비스가 내 문제를 풀어 줄지 확인하려는 사람",
    angles: ["이런 불편이 있다면 (문제 → 해결 과정)", "처음부터 끝까지 이렇게 써요 (사용 흐름)", "이 기능으로 이런 일이 쉬워져요", "이런 사람에게 맞는 서비스", "시작하는 방법"],
    blogBeats: ["사용자가 겪는 불편을 구체적 상황으로", "서비스가 그 불편을 푸는 과정(단계별)", "화면·기능을 보여주는 설명(화면 자리 표시)", "대표 사용 사례(제공된 것만)", "누구에게 맞는지", "가입·시작 방법"],
    ctaStyle: "가입 주소가 있으면 무료 체험·가입으로, 없으면 홈페이지 방문으로",
    claimRules: ["사용자 수·절감 시간·성과 수치·Before/After는 제공된 사실에 없으면 쓰지 않는다", "'업계 1위', '가장 빠른' 같은 비교는 쓰지 않는다", "없는 기능이나 연동을 있다고 쓰지 않는다", "무료·요금은 제공된 정보에 있을 때만 쓴다"],
    shortsBeats: ["사용자 불편을 건드리는 훅", "실제 화면·기능 시연", "해결된 결과", "가입 안내"],
    hookStyles: ["아직도 이걸 직접 하세요?", "30초면 끝나는 이유", "이 화면 하나면 됩니다"],
    visuals: "서비스 화면 캡처와 데모 이미지가 가장 설득력 있다. 화면은 꾸미지 않고 크게 보여준다.",
    closingLabel: "시작하기",
  },
};

export function promotionLabel(type: PromotionType): string {
  return PROMOTION_LABEL[type];
}

/**
 * The business facts as labelled lines, worded for its type ("상품명" for a product, "서비스명" for a platform).
 * Only what the owner entered; an empty answer produces no line.
 */
export function promotionFactLines(business: Business, type: PromotionType): string[] {
  const value = (key: Parameters<typeof promotionFieldValue>[1]) => promotionFieldValue(business, key);
  const line = (label: string, text: string | null) => (text ? `${label}: ${text}` : null);

  const lines: Array<string | null> =
    type === "STORE"
      ? [
        line("홍보 대상", "가게"),
        line("상호", value("name")),
        line("업종", value("industry")),
        line("위치", value("location")),
        line("주요 서비스·메뉴", value("mainOffering")),
        line("장점·차별점", value("strengths")),
        line("주요 고객", value("targetCustomer")),
        line("가격·프로모션(제공된 것만 사실)", value("priceInfo")),
        line("홈페이지·예약 주소", value("website")),
      ]
      : type === "PRODUCT"
        ? [
          line("홍보 대상", "상품"),
          line("상품명", value("name")),
          line("카테고리", value("industry")),
          line("주요 특징", value("mainOffering")),
          line("해결하는 문제", value("problem")),
          line("핵심 장점", value("strengths")),
          line("가격(제공된 것만 사실)", value("priceInfo")),
          line("구매 주소", value("actionUrl")),
          line("타깃 고객", value("targetCustomer")),
          line("판매 업체 홈페이지", value("website")),
        ]
        : [
          line("홍보 대상", "플랫폼(웹서비스·앱·SaaS)"),
          line("서비스명", value("name")),
          line("홈페이지", value("website")),
          line("주요 기능", value("mainOffering")),
          line("해결하는 문제", value("problem")),
          line("대상 사용자", value("targetCustomer")),
          line("차별점", value("strengths")),
          line("주요 사용 흐름", value("flow")),
          line("가입 주소", value("actionUrl")),
        ];
  return lines.filter((entry): entry is string => Boolean(entry));
}

/** The "how to plan this" paragraph given to the planner and the writer. */
export function promotionGuidance(type: PromotionType, purpose: "blog" | "shorts"): string[] {
  const strategy = PROMOTION_STRATEGY[type];
  const base = [
    `Promotion type: ${PROMOTION_LABEL[type]} (${type}). The reader/viewer: ${strategy.searchIntent}.`,
    `Natural call to action for this type: ${PROMOTION_CTA[type]} — ${strategy.ctaStyle}. Never promise anything the FACTS do not state.`,
    `Extra claim rules for this type: ${strategy.claimRules.join(" / ")}.`,
  ];
  if (purpose === "blog") {
    return [...base, `Angles that work for this type (pick one, vary it from recent posts): ${strategy.angles.join(" | ")}.`, `Beats the post should cover, in this order where the facts allow: ${strategy.blogBeats.join(" → ")}.`];
  }
  return [...base, `Short storyline: ${strategy.shortsBeats.join(" → ")}.`, `Hook styles (adapt, never copy verbatim): ${strategy.hookStyles.join(" | ")}.`, `Footage: ${strategy.visuals}`];
}

/** Falls back to STORE for a business created before the type existed; the runner asks owners to choose before generating. */
export function resolvePromotionType(business: Pick<Business, "promotion_type">): PromotionType {
  return business.promotion_type ?? "STORE";
}
