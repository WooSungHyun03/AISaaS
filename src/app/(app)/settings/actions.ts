"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { disconnectConnection } from "@/server/connectors/integrations";
import { verifyAndConnectWordPress } from "@/server/connectors/wordpress/connect";
import { isConnectorError } from "@/server/shared/errors";
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

function wordpressError(error: unknown): string {
  if (isConnectorError(error)) {
    if (error.code === "AUTH_FAILED" || error.code === "PERMISSION_DENIED") return "WordPress 사용자명, Application Password와 글 작성 권한을 확인해주세요.";
    if (error.code === "INVALID_TARGET") return "공개 HTTPS WordPress 사이트의 기본 주소를 입력해주세요.";
    if (error.code === "TIMEOUT" || error.code === "NETWORK_FAILURE") return "WordPress 사이트에 연결하지 못했습니다. 사이트 상태를 확인해주세요.";
  }
  return "WordPress 연결을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

export async function connectWordPress(_prevState: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const businessId = String(formData.get("businessId") ?? "");
  const siteUrl = String(formData.get("siteUrl") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const appPassword = String(formData.get("appPassword") ?? "").trim();
  if (!businessId || !siteUrl || !username || !appPassword) return { error: "모든 연결 정보를 입력해주세요." };
  if (siteUrl.length > 500 || username.length > 200 || appPassword.length > 500) return { error: "입력한 연결 정보가 너무 깁니다." };
  if (!(await ownedBusiness(user.id, businessId))) return { error: "본인의 사업체를 선택해주세요." };

  try {
    await verifyAndConnectWordPress({ userId: user.id, businessId, siteUrl, username, appPassword });
  } catch (error) {
    return { error: wordpressError(error) };
  }
  revalidatePath("/settings");
  return { success: true };
}

const PROVIDERS: IntegrationProvider[] = ["wordpress", "instagram", "email", "youtube"];

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
