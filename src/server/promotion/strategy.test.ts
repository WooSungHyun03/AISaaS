import { describe, expect, it } from "vitest";
import type { Business } from "@/types/domain";
import { promotionFactLines, promotionGuidance, PROMOTION_STRATEGY, resolvePromotionType } from "./strategy";

const base: Business = {
  id: "b1",
  owner_id: "u1",
  name: "모닝 베이커리",
  industry: "카페",
  description: null,
  location: "서울 성수동",
  target_customer: "직장인",
  brand_tone: null,
  keywords: [],
  website: "https://morning.example",
  sns_links: {},
  main_offering: "소금빵",
  strengths: "매일 직접 구움",
  marketing_goal: null,
  promotion_type: "STORE",
  promotion_details: { problem: "눅눅한 빵이 싫어요", priceInfo: "소금빵 3,500원", actionUrl: "https://shop.example/p/1", flow: "입력 → 생성 → 게시" },
  public_widget_id: "w",
  created_at: "",
  updated_at: "",
};

describe("promotionFactLines", () => {
  it("words a store's facts for a store and includes price only as owner-provided", () => {
    const lines = promotionFactLines(base, "STORE");
    expect(lines).toContain("상호: 모닝 베이커리");
    expect(lines).toContain("위치: 서울 성수동");
    expect(lines.join("\n")).toContain("가격·프로모션(제공된 것만 사실): 소금빵 3,500원");
    expect(lines.join("\n")).not.toContain("해결하는 문제");
  });

  it("uses product wording and the purchase address for a product", () => {
    const lines = promotionFactLines({ ...base, promotion_type: "PRODUCT" }, "PRODUCT");
    expect(lines).toContain("상품명: 모닝 베이커리");
    expect(lines).toContain("해결하는 문제: 눅눅한 빵이 싫어요");
    expect(lines).toContain("구매 주소: https://shop.example/p/1");
    expect(lines.join("\n")).not.toContain("위치:");
  });

  it("uses service wording, the usage flow and the sign-up address for a platform", () => {
    const lines = promotionFactLines({ ...base, promotion_type: "PLATFORM" }, "PLATFORM");
    expect(lines).toContain("서비스명: 모닝 베이커리");
    expect(lines).toContain("주요 사용 흐름: 입력 → 생성 → 게시");
    expect(lines).toContain("가입 주소: https://shop.example/p/1");
  });

  it("writes no line for an empty answer instead of inventing one", () => {
    const lines = promotionFactLines({ ...base, location: null, promotion_details: {} }, "STORE");
    expect(lines.some((line) => line.startsWith("위치"))).toBe(false);
    expect(lines.some((line) => line.startsWith("가격"))).toBe(false);
  });
});

describe("strategies differ by type", () => {
  it("gives each type its own storyline, call to action and claim rules", () => {
    const store = promotionGuidance("STORE", "shorts").join("\n");
    const product = promotionGuidance("PRODUCT", "shorts").join("\n");
    const platform = promotionGuidance("PLATFORM", "shorts").join("\n");
    expect(store).toContain("방문·예약 안내");
    expect(product).toContain("상품을 쓰는 장면(시연)");
    expect(platform).toContain("실제 화면·기능 시연");
    expect(new Set([store, product, platform]).size).toBe(3);
    expect(PROMOTION_STRATEGY.PRODUCT.claimRules.join(" ")).toContain("효능");
    expect(PROMOTION_STRATEGY.PLATFORM.claimRules.join(" ")).toContain("사용자 수");
  });

  it("blog guidance names the angles and beats; shorts guidance names hooks and footage", () => {
    const blog = promotionGuidance("PRODUCT", "blog").join("\n");
    expect(blog).toContain("Angles that work");
    expect(blog).toContain("Beats the post should cover");
    expect(promotionGuidance("PRODUCT", "shorts").join("\n")).toContain("Hook styles");
  });

  it("falls back to STORE only when the owner has not chosen (the runner asks before generating)", () => {
    expect(resolvePromotionType({ promotion_type: null })).toBe("STORE");
    expect(resolvePromotionType({ promotion_type: "PLATFORM" })).toBe("PLATFORM");
  });
});
