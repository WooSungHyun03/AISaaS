import "server-only";

import { z } from "zod";
import { SETUP_AUTOMATION_TYPES, SETUP_BUDGET_RANGES } from "@/types/setup-request";

export const setupRequestInputSchema = z.object({
  automationType: z.string().refine((value) => SETUP_AUTOMATION_TYPES.some((option) => option.value === value), "자동화 유형을 선택해주세요."),
  currentWork: z.string().trim().min(10, "현재 업무를 10자 이상 입력해주세요.").max(2_000),
  desiredOutcome: z.string().trim().min(10, "원하는 결과를 10자 이상 입력해주세요.").max(2_000),
  budgetRange: z.string().refine((value) => SETUP_BUDGET_RANGES.includes(value as (typeof SETUP_BUDGET_RANGES)[number]), "예산 범위를 선택해주세요."),
  contactMethod: z.enum(["EMAIL", "PHONE", "KAKAO", "OTHER"]),
  contactValue: z.string().trim().min(3, "연락받을 정보를 입력해주세요.").max(200),
  notes: z.string().trim().max(2_000).optional(),
}).superRefine((value, context) => {
  if (value.contactMethod === "EMAIL" && !z.string().email().safeParse(value.contactValue).success) {
    context.addIssue({ code: "custom", path: ["contactValue"], message: "올바른 이메일 주소를 입력해주세요." });
  }
});
