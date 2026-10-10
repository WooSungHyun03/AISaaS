"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env/client";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { describeAuthError } from "@/lib/auth-errors";
import { isPlausibleEmail, validateNewPassword } from "@/lib/auth-validation";
import { RECOVERY_COOKIE, RECOVERY_PATH } from "@/lib/supabase/route-access";
import { logger } from "@/lib/logger";

export interface AuthActionState {
  error?: string;
  success?: boolean;
}

const safeRedirectTo = (value: string) => safeRedirectPath(value);

function callbackUrl(next: string): string {
  return `${clientEnv.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`;
}

export async function signIn(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirectTo(String(formData.get("redirectTo") ?? "/dashboard"));

  if (!email || email.length > 320 || !email.includes("@") || password.length < 8 || password.length > 128) {
    return { error: "이메일과 8자 이상의 비밀번호를 확인해주세요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "email_not_confirmed") return { error: describeAuthError(error) };
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  redirect(redirectTo || "/dashboard");
}

export async function signUp(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const redirectTo = safeRedirectTo(String(formData.get("redirectTo") ?? "/onboarding"));
  const onboardingPath = /^\/billing\?plan=(STARTER|PRO)$/.test(redirectTo) || redirectTo === "/setup-request"
    ? `/onboarding?next=${encodeURIComponent(redirectTo)}`
    : "/onboarding";

  if (!displayName || displayName.length > 100) return { error: "이름은 1~100자로 입력해주세요." };
  if (!isPlausibleEmail(email)) return { error: "올바른 이메일 주소를 입력해주세요." };
  if (password.length < 8 || password.length > 128) return { error: "비밀번호는 8~128자로 입력해주세요." };
  if (formData.get("agreeTerms") !== "on") return { error: "이용약관과 개인정보처리방침에 동의해주세요." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName },
      // Lets the confirmation link sign the user in and continue onboarding.
      emailRedirectTo: callbackUrl(onboardingPath),
    },
  });

  if (error) {
    logger.warn("auth_signup_failed", { code: error.code ?? "unknown" });
    return { error: describeAuthError(error, "가입하지 못했어요. 잠시 후 다시 시도해주세요.") };
  }

  if (!data.session) {
    redirect(`/login?redirectTo=${encodeURIComponent(onboardingPath)}&checkEmail=1`);
  }

  redirect(onboardingPath);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Sends a reset link. The reply is the same whether or not the address has an
 * account, so the form can't be used to discover who is registered.
 */
export async function requestPasswordReset(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!isPlausibleEmail(email)) return { error: "올바른 이메일 주소를 입력해주세요." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl(RECOVERY_PATH) });
  if (error) {
    logger.warn("auth_password_reset_request_failed", { code: error.code ?? "unknown" });
    if (error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return { error: describeAuthError(error) };
    }
  }
  return { success: true };
}

/** Sets a new password for a session that arrived through a recovery link. */
export async function completePasswordReset(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const password = String(formData.get("password") ?? "");
  const invalid = validateNewPassword(password, String(formData.get("confirmPassword") ?? ""));
  if (invalid) return { error: invalid };

  const cookieStore = await cookies();
  if (cookieStore.get(RECOVERY_COOKIE)?.value !== "1") {
    return { error: "재설정 링크가 만료됐어요. 비밀번호 찾기를 다시 진행해주세요." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "재설정 링크가 만료됐어요. 비밀번호 찾기를 다시 진행해주세요." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logger.warn("auth_password_reset_failed", { code: error.code ?? "unknown" });
    return { error: describeAuthError(error, "비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해주세요.") };
  }

  cookieStore.delete({ name: RECOVERY_COOKIE, path: RECOVERY_PATH });
  return { success: true };
}

/** Signed-in password change; the current password is re-checked first. */
export async function changePassword(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  const invalid = validateNewPassword(password, String(formData.get("confirmPassword") ?? ""));
  if (invalid) return { error: invalid };
  if (!currentPassword) return { error: "현재 비밀번호를 입력해주세요." };
  if (currentPassword === password) return { error: describeAuthError({ code: "same_password" }) };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return { error: "로그인이 필요합니다." };

  const { error: verifyError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (verifyError) return { error: "현재 비밀번호가 올바르지 않아요." };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    logger.warn("auth_password_change_failed", { code: error.code ?? "unknown" });
    return { error: describeAuthError(error, "비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해주세요.") };
  }
  return { success: true };
}
