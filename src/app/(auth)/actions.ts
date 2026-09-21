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
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const redirectTo = safeRedirectTo(String(formData.get("redirectTo") ?? "/dashboard"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  redirect(redirectTo || "/dashboard");
}

export async function signUp(_prevState: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "");
  const redirectTo = safeRedirectTo(String(formData.get("redirectTo") ?? "/dashboard"));

  if (password.length < 8) {
    return { error: "비밀번호는 8자 이상이어야 합니다." };
  }

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
    redirect(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  redirect(redirectTo);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
