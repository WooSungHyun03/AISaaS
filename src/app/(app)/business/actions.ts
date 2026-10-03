"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { BusinessSnsLinks } from "@/types/domain";

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

const SNS_LINK_KEYS = ["instagram", "facebook", "youtube", "blog"] as const;

function snsLinksFromForm(formData: FormData): BusinessSnsLinks {
  const links: BusinessSnsLinks = {};
  for (const key of SNS_LINK_KEYS) {
    const value = String(formData.get(`snsLinks.${key}`) ?? "").trim();
    if (value) links[key] = value;
  }
  return links;
}

function businessFieldsFromForm(formData: FormData) {
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
  };
}

function validateBusinessFields(fields: ReturnType<typeof businessFieldsFromForm>): string | null {
  if (!fields.name) return "사업체 이름을 입력해주세요.";
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
  for (const link of Object.values(fields.sns_links)) {
    if (!link) continue;
    try {
      const url = new URL(link);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "SNS 링크는 http 또는 https 주소로 입력해주세요.";
    } catch {
      return "SNS 링크 형식을 확인해주세요.";
    }
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
  const fields = businessFieldsFromForm(formData);
  const validationError = validateBusinessFields(fields);
  if (validationError) return { error: validationError };

  const { error } = await supabase.from("businesses").update(fields).eq("id", businessId);
  if (error) return { error: "사업체 정보를 수정하는 중 오류가 발생했습니다." };

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
