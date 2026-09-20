"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface SetupRequestState {
  error?: string;
  success?: boolean;
}

export async function createSetupRequest(_prevState: SetupRequestState, formData: FormData): Promise<SetupRequestState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "로그인이 필요합니다." };
  }

  const automationType = String(formData.get("automationType") ?? "");
  const description = String(formData.get("description") ?? "");
  const budgetRange = String(formData.get("budgetRange") ?? "");

  if (!automationType) {
    return { error: "자동화 유형을 선택해주세요." };
  }

  const { error } = await supabase.from("setup_requests").insert({
    user_id: user.id,
    automation_type: automationType,
    description,
    budget_range: budgetRange || null,
  });

  if (error) {
    return { error: "요청 접수 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." };
  }

  revalidatePath("/pricing");
  return { success: true };
}
