"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
  };
}

export async function createBusiness(_prevState: BusinessActionState, formData: FormData): Promise<BusinessActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const fields = businessFieldsFromForm(formData);
  if (!fields.name) return { error: "사업체 이름을 입력해주세요." };

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
  if (!fields.name) return { error: "사업체 이름을 입력해주세요." };

  const { error } = await supabase.from("businesses").update(fields).eq("id", businessId);
  if (error) return { error: "사업체 정보를 수정하는 중 오류가 발생했습니다." };

  revalidatePath("/business");
  return {};
}

export async function deleteBusiness(businessId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("businesses").delete().eq("id", businessId);
  revalidatePath("/business");
  revalidatePath("/dashboard");
}
