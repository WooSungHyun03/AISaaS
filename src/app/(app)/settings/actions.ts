"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface SettingsActionState {
  error?: string;
  success?: boolean;
}

export async function updateProfile(_prevState: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const displayName = String(formData.get("displayName") ?? "").trim();
  const { error } = await supabase.from("profiles").update({ display_name: displayName || null }).eq("id", user.id);

  if (error) return { error: "프로필 저장 중 오류가 발생했습니다." };

  revalidatePath("/settings");
  return { success: true };
}
