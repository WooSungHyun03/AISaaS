"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateSnsLink, type SnsLinkKey } from "@/lib/sns-links";
import type { BusinessSnsLinks, Json } from "@/types/domain";
import { isPromotionType, PROMOTION_DETAIL_LIMITS, type PromotionDetails, type PromotionType } from "@/types/promotion";

export interface BusinessActionState {
  error?: string;
  success?: boolean;
}

function parseKeywords(raw: string): string[] {
  return raw
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

// A saved business may still have a value under the old generic "blog" key
// — that's only ever read back for display (mergeSnsLinks in
// src/components/business/prefill.ts), never submitted by this form, so
// every save here writes "naver_blog" and effectively migrates it forward.
const SNS_LINK_KEYS = ["instagram", "facebook", "youtube", "naver_blog", "naver_place", "kakao_channel"] as const;

function snsLinksFromForm(formData: FormData): BusinessSnsLinks {
  const links: BusinessSnsLinks = {};
  for (const key of SNS_LINK_KEYS) {
    const value = String(formData.get(`snsLinks.${key}`) ?? "").trim();
    if (value) links[key] = value;
  }
  return links;
}

function promotionDetailsFromForm(formData: FormData): PromotionDetails {
  const read = (key: string) => String(formData.get(key) ?? "").trim() || undefined;
  const details: PromotionDetails = { problem: read("problem"), priceInfo: read("priceInfo"), actionUrl: read("actionUrl"), flow: read("flow") };
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)) as PromotionDetails;
}

function businessFieldsFromForm(formData: FormData) {
  const promotionTypeRaw = String(formData.get("promotionType") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const services = String(formData.get("services") ?? "").trim();
  return {
    name: String(formData.get("name") ?? "").trim(),
    industry: String(formData.get("industry") ?? "").trim() || null,
    description: [description, services ? `주요 서비스: ${services}` : ""].filter(Boolean).join("\n\n") || null,
    location: String(formData.get("location") ?? "").trim() || null,
    target_customer: String(formData.get("targetCustomer") ?? "").trim() || null,
    brand_tone: String(formData.get("brandTone") ?? "").trim() || null,
    keywords: parseKeywords(String(formData.get("keywords") ?? "")),
    website: String(formData.get("website") ?? "").trim() || null,
    main_offering: String(formData.get("mainOffering") ?? "").trim() || null,
    strengths: String(formData.get("strengths") ?? "").trim() || null,
    marketing_goal: String(formData.get("marketingGoal") ?? "").trim() || null,
    sns_links: snsLinksFromForm(formData),
    // Forms that do not ask the question (older dialogs, tests) must not wipe an earlier answer.
    ...(promotionTypeRaw ? { promotion_type: promotionTypeRaw as PromotionType, promotion_details: promotionDetailsFromForm(formData) as unknown as Json } : {}),
  };
}

function validateBusinessFields(fields: ReturnType<typeof businessFieldsFromForm>): string | null {
  if (!fields.name) return "사업체 이름을 입력해주세요.";
  if ("promotion_type" in fields && !isPromotionType(fields.promotion_type)) return "홍보 대상(가게·상품·플랫폼)을 다시 골라주세요.";
  const details = (fields.promotion_details ?? {}) as PromotionDetails;
  if ((details.problem?.length ?? 0) > PROMOTION_DETAIL_LIMITS.problem || (details.priceInfo?.length ?? 0) > PROMOTION_DETAIL_LIMITS.priceInfo
    || (details.flow?.length ?? 0) > PROMOTION_DETAIL_LIMITS.flow || (details.actionUrl?.length ?? 0) > PROMOTION_DETAIL_LIMITS.actionUrl) {
    return "해결하는 문제, 가격, 사용 흐름, 주소 입력 길이를 확인해주세요.";
  }
  if (details.actionUrl) {
    try {
      const url = new URL(details.actionUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "구매·가입 주소는 http 또는 https 주소로 입력해주세요.";
    } catch {
      return "구매·가입 주소 형식을 확인해주세요.";
    }
  }
  if (fields.name.length > 100) return "사업체 이름은 100자 이하로 입력해주세요.";
  if ((fields.industry?.length ?? 0) > 100 || (fields.location?.length ?? 0) > 200) return "업종과 위치 입력이 너무 깁니다.";
  if ((fields.description?.length ?? 0) > 2500 || (fields.target_customer?.length ?? 0) > 500 || (fields.brand_tone?.length ?? 0) > 200) return "사업 정보 입력 길이를 확인해주세요.";
  if (fields.keywords.length > 20 || fields.keywords.some((keyword) => keyword.length > 50)) return "키워드는 각각 50자 이하로 최대 20개까지 입력해주세요.";
  if ((fields.main_offering?.length ?? 0) > 300 || (fields.strengths?.length ?? 0) > 300 || (fields.marketing_goal?.length ?? 0) > 200) {
    return "주요 상품/서비스, 강점, 마케팅 목표 입력 길이를 확인해주세요.";
  }
  if (fields.website) {
    try {
      const url = new URL(fields.website);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "웹사이트 주소는 http 또는 https 주소로 입력해주세요.";
    } catch {
      return "웹사이트 주소 형식을 확인해주세요.";
    }
  }
  for (const [key, link] of Object.entries(fields.sns_links)) {
    if (!link) continue;
    const message = validateSnsLink(key as SnsLinkKey, link);
    if (message) return message;
  }
  return null;
}

export async function createBusiness(_prevState: BusinessActionState, formData: FormData): Promise<BusinessActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const fields = businessFieldsFromForm(formData);
  const validationError = validateBusinessFields(fields);
  if (validationError) return { error: validationError };

  const { error } = await supabase.from("businesses").insert({ owner_id: user.id, ...fields });
  if (error) return { error: "사업체 등록 중 오류가 발생했습니다." };

  revalidatePath("/business");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function updateBusiness(
  businessId: string,
  _prevState: BusinessActionState,
  formData: FormData,
): Promise<BusinessActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const fields = businessFieldsFromForm(formData);
  const validationError = validateBusinessFields(fields);
  if (validationError) return { error: validationError };

  // RLS turns an update of someone else's (or an already deleted) business into 0 rows, not an error —
  // without reading the row back the form said "저장됨" while nothing was saved.
  const { data: updated, error } = await supabase.from("businesses").update(fields)
    .eq("id", businessId).eq("owner_id", user.id).select("id").maybeSingle();
  if (error) return { error: "사업체 정보를 수정하는 중 오류가 발생했습니다." };
  if (!updated) return { error: "수정할 사업체를 찾을 수 없습니다. 페이지를 새로고침해주세요." };

  revalidatePath("/business");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteBusiness(businessId: string): Promise<BusinessActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data, error } = await supabase.from("businesses").delete().eq("id", businessId).eq("owner_id", user.id).select("id").maybeSingle();
  if (error || !data) return { error: "사업체를 삭제하지 못했습니다. 연결된 자동화 상태를 확인해주세요." };
  revalidatePath("/business");
  revalidatePath("/dashboard");
  return { success: true };
}
