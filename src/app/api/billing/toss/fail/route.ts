import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env/client";
import {
  getCheckoutSession,
  markCheckoutCanceled,
  markCheckoutFailed,
} from "@/server/billing/checkout-sessions";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const sessionId = requestUrl.searchParams.get("session");
  const rawCode = requestUrl.searchParams.get("code") ?? "PAY_PROCESS_ABORTED";
  const code = /^[A-Z0-9_]{1,80}$/.test(rawCode) ? rawCode : "PAY_PROCESS_ABORTED";
  const providerMessage = requestUrl.searchParams.get("message") ?? "결제 인증에 실패했습니다.";

  const destination = new URL("/billing/fail", clientEnv.NEXT_PUBLIC_SITE_URL);
  destination.searchParams.set("code", code);
  if (sessionId) destination.searchParams.set("session", sessionId);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !sessionId) return NextResponse.redirect(destination);

  try {
    const session = await getCheckoutSession(sessionId, user.id);
    if (session.provider === "toss") {
      if (code === "PAY_PROCESS_CANCELED") await markCheckoutCanceled(session.id);
      else await markCheckoutFailed(session.id, code, providerMessage);
    }
  } catch (error) {
    logger.error("toss_failure_callback_update_failed", {
      userId: user.id,
      sessionId,
      message: error instanceof Error ? error.message : "unknown error",
    });
  }

  return NextResponse.redirect(destination);
}
