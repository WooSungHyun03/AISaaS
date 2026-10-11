"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { disconnectConnection } from "@/server/connectors/integrations";
import type { IntegrationProvider } from "@/types/domain";

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
  if (displayName.length > 100) return { error: "이름은 100자 이하로 입력해주세요." };
  const { error } = await supabase.from("profiles").update({ display_name: displayName || null }).eq("id", user.id);

  if (error) return { error: "프로필 저장 중 오류가 발생했습니다." };

  revalidatePath("/settings");
  return { success: true };
}

async function ownedBusiness(userId: string, businessId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("businesses").select("id")
    .eq("id", businessId).eq("owner_id", userId).maybeSingle();
  return !error && Boolean(data);
}

const PROVIDERS: IntegrationProvider[] = ["instagram", "youtube"];

export async function disconnectIntegration(businessId: string, provider: IntegrationProvider): Promise<SettingsActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };
  if (!PROVIDERS.includes(provider) || !(await ownedBusiness(user.id, businessId))) return { error: "연결 정보를 찾을 수 없습니다." };

  const { data: connection, error } = await supabase.from("integration_connections").select("id")
    .eq("user_id", user.id).eq("business_id", businessId).eq("provider", provider).maybeSingle();
  if (error || !connection) return { error: "연결 정보를 찾을 수 없습니다." };
  try {
    await disconnectConnection(createAdminClient(), connection.id);
  } catch {
    return { error: "연결을 해제하지 못했습니다. 잠시 후 다시 시도해주세요." };
  }
  revalidatePath("/settings");
  return { success: true };
}
