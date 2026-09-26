import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env/client";
import { TossBillingProvider } from "@/server/billing/providers/toss";
import { BillingCheckoutError } from "@/server/billing/checkout-sessions";
import { TossApiError } from "@/server/billing/providers/toss-api";
import { logger } from "@/lib/logger";

function failureUrl(code: string, message: string, sessionId?: string) {
  const url = new URL("/billing/fail", clientEnv.NEXT_PUBLIC_SITE_URL);
  url.searchParams.set("code", code);
  url.searchParams.set("message", message.slice(0, 200));
  if (sessionId) url.searchParams.set("session", sessionId);
  return url;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const sessionId = requestUrl.searchParams.get("session") ?? undefined;
  const authKey = requestUrl.searchParams.get("authKey") ?? undefined;
  const customerKey = requestUrl.searchParams.get("customerKey") ?? undefined;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const login = new URL("/login", clientEnv.NEXT_PUBLIC_SITE_URL);
    login.searchParams.set("next", requestUrl.pathname + requestUrl.search);
    return NextResponse.redirect(login);
  }
  if (!sessionId) return NextResponse.redirect(failureUrl("INVALID_CALLBACK", "결제 요청 정보가 누락되었습니다."));

  try {
    await new TossBillingProvider().completeCheckout({ userId: user.id, sessionId, authKey, customerKey });
    const success = new URL("/billing/success", clientEnv.NEXT_PUBLIC_SITE_URL);
    success.searchParams.set("session", sessionId);
    return NextResponse.redirect(success);
  } catch (error) {
    const code = error instanceof BillingCheckoutError || error instanceof TossApiError ? error.code : "CHECKOUT_FAILED";
    const message = error instanceof Error ? error.message : "결제 처리에 실패했습니다.";
    logger.error("toss_success_callback_failed", { userId: user.id, sessionId, code });
    return NextResponse.redirect(failureUrl(code, message, sessionId));
  }
}
