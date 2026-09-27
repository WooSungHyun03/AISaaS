import { describe, expect, it } from "vitest";
import { setupRequestInputSchema } from "./setup-request-input";

const validInput = {
  automationType: "blog-marketing",
  currentWork: "매주 세 번 블로그 글을 직접 작성하고 게시합니다.",
  desiredOutcome: "초안을 자동 생성해서 WordPress에 저장하고 싶습니다.",
  budgetRange: "30~50만원",
  contactMethod: "EMAIL" as const,
  contactValue: "owner@example.com",
  notes: "다음 달 시작 희망",
};

describe("setupRequestInputSchema", () => {
  it("accepts a complete setup request", () => {
    expect(setupRequestInputSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects an unknown automation type or budget", () => {
    expect(setupRequestInputSchema.safeParse({ ...validInput, automationType: "unknown" }).success).toBe(false);
    expect(setupRequestInputSchema.safeParse({ ...validInput, budgetRange: "무료" }).success).toBe(false);
  });

  it("requires a valid email when email contact is selected", () => {
    const result = setupRequestInputSchema.safeParse({ ...validInput, contactValue: "not-an-email" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("올바른 이메일 주소를 입력해주세요.");
  });
});
