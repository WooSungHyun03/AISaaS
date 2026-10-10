import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env/client";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { RECOVERY_COOKIE, RECOVERY_PATH } from "@/lib/supabase/route-access";
import { logger } from "@/lib/logger";

const OTP_TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/**
 * Landing URL for Supabase email links (sign-up confirmation, password
 * recovery). Exchanges the one-time code for a session cookie, then sends the
 * user on to a same-site `next` path.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // Email links are built from NEXT_PUBLIC_SITE_URL, so this route is reached
  // on that origin; redirect there too (request.url can report "localhost" in
  // dev, which would drop the freshly set session cookie).
  const origin = clientEnv.NEXT_PUBLIC_SITE_URL;
  const next = safeRedirectPath(searchParams.get("next") ?? "/dashboard");
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();
  let failed = true;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
    if (error) logger.warn("auth_callback_exchange_failed", { code: error.code ?? "unknown" });
  } else if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    failed = Boolean(error);
    if (error) logger.warn("auth_callback_verify_failed", { code: error.code ?? "unknown" });
  }

  const isRecovery = next === RECOVERY_PATH || type === "recovery";
  if (failed) {
    const target = new URL(isRecovery ? "/forgot-password" : "/login", origin);
    target.searchParams.set("linkError", "1");
    return NextResponse.redirect(target);
  }

  const response = NextResponse.redirect(new URL(isRecovery ? RECOVERY_PATH : next, origin));
  if (isRecovery) {
    response.cookies.set(RECOVERY_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: RECOVERY_PATH,
      maxAge: 15 * 60,
    });
  }
  return response;
}
