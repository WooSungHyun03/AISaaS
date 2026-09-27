import { z } from "zod";

/**
 * Single source of truth for `directory_tools.category`. Any change here
 * must ship with a new supabase/migrations/00XX_*.sql that re-creates the
 * `directory_tools_category_check` constraint (same name) with the same
 * values — taxonomy.test.ts finds the highest-numbered migration mentioning
 * that constraint name and asserts it matches this list, so keeping the
 * name stable is what lets that check follow future changes automatically.
 */
export const DIRECTORY_CATEGORIES = [
  "automation-platform",
  "ai-infrastructure",
  "content-creation",
  "marketing-automation",
  "customer-support",
  "productivity",
  "other",
] as const;

export type DirectoryCategory = (typeof DIRECTORY_CATEGORIES)[number];

export const directoryCategorySchema = z.enum(DIRECTORY_CATEGORIES);

export const DIRECTORY_CATEGORY_LABELS: Record<DirectoryCategory, string> = {
  "automation-platform": "자동화 플랫폼",
  "ai-infrastructure": "AI 인프라/프레임워크",
  "content-creation": "콘텐츠 생성",
  "marketing-automation": "마케팅 자동화",
  "customer-support": "고객 응대",
  productivity: "생산성",
  other: "기타",
};

export const DIRECTORY_CATEGORY_DESCRIPTIONS: Record<DirectoryCategory, string> = {
  "automation-platform": "노코드/워크플로우 자동화 도구 (예: n8n)",
  "ai-infrastructure": "AI 앱 개발용 프레임워크·백엔드·모델 인프라 (예: LangChain, Supabase)",
  "content-creation": "텍스트·이미지·영상 콘텐츠 생성 도구",
  "marketing-automation": "마케팅·SNS·이메일 캠페인 자동화 도구",
  "customer-support": "챗봇/헬프데스크 등 고객 문의 대응 도구",
  productivity: "문서·일정·노트 등 업무 생산성 도구",
  other: "위 카테고리에 속하지 않는 도구",
};
