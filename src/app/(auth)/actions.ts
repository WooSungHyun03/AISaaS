"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthActionState {
  error?: string;
}

function safeRedirectTo(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/dashboard";
  }
  return value;
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
  if (!email || email.length > 320 || !email.includes("@")) return { error: "올바른 이메일 주소를 입력해주세요." };
  if (password.length < 8 || password.length > 128) return { error: "비밀번호는 8~128자로 입력해주세요." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });

  if (error) {
    return { error: error.message };
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
