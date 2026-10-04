import { describe, expect, it } from "vitest";
import { assessBlogBody } from "./blog-quality";

const GOOD = [
  "성수동에서 카페를 운영하다 보면 아침 손님이 가장 먼저 찾는 메뉴가 분명하게 보입니다. 우리 가게에서는 갓 구운 소금빵이 그 자리를 차지했습니다.",
  "빵은 오전 7시에 첫 판이 나옵니다. 출근 전에 들르는 손님은 줄을 서지 않도록 전날 예약해 두는 경우가 많고, 예약 픽업 선반은 입구 오른쪽에 따로 마련해 두었습니다.",
  "원두는 매주 화요일에 로스팅합니다. 빵과 함께 마실 커피는 산미가 약한 중배전을 권하는데, 단맛이 짠맛을 눌러 주기 때문입니다. 주문하실 때 말씀해 주시면 맞춰 내려 드립니다.",
  "소금빵은 한 번에 열두 개씩만 굽기 때문에 오후에는 품절되는 날이 있습니다. 저녁에 드시고 싶다면 점심 전에 전화로 수량을 미리 말씀해 주세요. 포장 상자는 따로 요청하지 않으셔도 기본으로 드립니다.",
  "처음 오시는 분이라면 소금빵과 아메리카노 조합부터 드셔 보세요. 평일 오전 9시 이전에는 한산해서 자리를 고르기도 편합니다.",
].map((paragraph) => `<p>${paragraph}</p>`).join("");

describe("assessBlogBody", () => {
  it("passes a natural, well-structured post", () => {
    expect(assessBlogBody({ bodyHtml: GOOD, keywords: ["소금빵", "성수동 카페"] }).join(" | ")).toBe("");
  });

  it("flags short, single-paragraph posts", () => {
    const issues = assessBlogBody({ bodyHtml: "<p>짧은 글입니다.</p>", keywords: [] });
    expect(issues.join(" ")).toContain("너무 짧아요");
    expect(issues.join(" ")).toContain("문단을");
  });

  it("flags keyword stuffing", () => {
    const stuffed = `${GOOD}<p>${"소금빵 맛집 소금빵 추천 소금빵 ".repeat(3)}</p>`;
    expect(assessBlogBody({ bodyHtml: stuffed, keywords: ["소금빵"] }).join(" ")).toContain("반복돼요");
  });

  it("flags stock AI phrasing, exclamations and emoji", () => {
    const text = `<p>안녕하세요, 오늘은 소금빵을 알아보겠습니다! 최고의 맛! 지금 바로 오세요! 정말요! 😀😀😀</p>${GOOD}`;
    const joined = assessBlogBody({ bodyHtml: text, keywords: [] }).join(" ");
    expect(joined).toContain("상투적인 표현");
    expect(joined).toContain("느낌표");
    expect(joined).toContain("이모지");
  });

  it("flags three sentences in a row starting the same way", () => {
    const repeated = `${GOOD}<p>우리 가게는 맛있습니다. 우리 가게는 친절합니다. 우리 가게는 깨끗합니다.</p>`;
    expect(assessBlogBody({ bodyHtml: repeated, keywords: [] }).join(" ")).toContain("문장 시작");
  });
});
