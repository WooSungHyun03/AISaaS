import { z } from "zod";

export const INQUIRY_CATEGORIES = ["PAYMENT", "REFUND", "BUG", "FEATURE", "OTHER"] as const;
export type InquiryCategory = (typeof INQUIRY_CATEGORIES)[number];
export const INQUIRY_CATEGORY_LABEL: Record<InquiryCategory, string> = {
  PAYMENT: "결제",
  REFUND: "환불",
  BUG: "서비스 오류",
  FEATURE: "기능 문의·제안",
  OTHER: "기타",
};

export const INQUIRY_STATUSES = ["RECEIVED", "IN_REVIEW", "ANSWERED", "CLOSED"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const INQUIRY_STATUS_LABEL: Record<InquiryStatus, string> = {
  RECEIVED: "접수",
  IN_REVIEW: "확인 중",
  ANSWERED: "답변 완료",
  CLOSED: "종료",
};

export const INQUIRY_SUBJECT = { min: 2, max: 120 } as const;
export const INQUIRY_BODY = { min: 10, max: 4_000 } as const;
export const INQUIRY_REPLY_MAX = 4_000;
/** Matches the database policy: more than this many new inquiries in an hour is refused. */
export const INQUIRIES_PER_HOUR = 5;

export const inquiryInputSchema = z.object({
  category: z.enum(INQUIRY_CATEGORIES, { message: "문의 유형을 골라주세요." }),
  subject: z.string().trim().min(INQUIRY_SUBJECT.min, `제목을 ${INQUIRY_SUBJECT.min}자 이상 입력해주세요.`).max(INQUIRY_SUBJECT.max, `제목은 ${INQUIRY_SUBJECT.max}자 이하로 입력해주세요.`),
  body: z.string().trim().min(INQUIRY_BODY.min, `내용을 ${INQUIRY_BODY.min}자 이상 입력해주세요.`).max(INQUIRY_BODY.max, `내용은 ${INQUIRY_BODY.max.toLocaleString()}자 이하로 입력해주세요.`),
});
export type InquiryInput = z.infer<typeof inquiryInputSchema>;

export interface InquiryMessageView {
  id: string;
  kind: "REPLY" | "STATUS_CHANGE";
  body: string | null;
  fromStatus: InquiryStatus | null;
  toStatus: InquiryStatus | null;
  createdAt: string;
}

export interface InquiryView {
  id: string;
  category: InquiryCategory;
  subject: string;
  body: string;
  status: InquiryStatus;
  createdAt: string;
  updatedAt: string;
  messages: InquiryMessageView[];
}
