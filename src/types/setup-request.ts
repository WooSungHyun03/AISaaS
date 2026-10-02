import type { SetupRequestContactMethod, SetupRequestStatus } from "./domain";

export const SETUP_AUTOMATION_TYPES = [
  { value: "blog-marketing", label: "블로그 마케팅 자동화" },
  { value: "instagram-marketing", label: "Instagram 마케팅 자동화" },
  { value: "newsletter", label: "뉴스레터·이메일 자동화" },
  { value: "customer-support", label: "고객 문의·CS 자동화" },
  { value: "job-postings", label: "채용공고 탐색 자동화" },
  { value: "article-collection", label: "관심 주제 기사·글 수집" },
  { value: "shorts", label: "유튜브 쇼츠 제작" },
  { value: "other", label: "기타 / 상담 후 결정" },
] as const;

export const SETUP_BUDGET_RANGES = ["10만원 미만", "10~30만원", "30~50만원", "50~100만원", "100만원 이상", "상담 후 결정"] as const;

export const SETUP_CONTACT_METHODS: Array<{ value: SetupRequestContactMethod; label: string }> = [
  { value: "EMAIL", label: "이메일" },
  { value: "PHONE", label: "전화 또는 문자" },
  { value: "KAKAO", label: "카카오톡" },
  { value: "OTHER", label: "기타" },
];

export const SETUP_REQUEST_STATUS: Record<SetupRequestStatus, { label: string; description: string }> = {
  REQUESTED: { label: "접수 완료", description: "요청 내용을 확인하고 있어요." },
  CONTACTED: { label: "연락 완료", description: "담당자가 상담을 위해 연락드렸어요." },
  IN_PROGRESS: { label: "세팅 진행 중", description: "협의한 내용으로 세팅하고 있어요." },
  COMPLETED: { label: "세팅 완료", description: "세팅과 확인이 끝났어요." },
  CANCELLED: { label: "요청 취소", description: "요청이 취소됐어요." },
};

export function setupAutomationTypeLabel(value: string) {
  return SETUP_AUTOMATION_TYPES.find((option) => option.value === value)?.label ?? value;
}

export function setupRequestNumber(id: string) {
  return `SR-${id.replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}
