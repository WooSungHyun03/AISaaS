import { NextRequest, NextResponse } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";
import { createClient } from "@/lib/supabase/server";
import { completeInstagramOAuth, isMatchingOAuthState, parseInstagramOAuthCookie } from "@/server/connectors/instagram/connect";
import { INSTAGRAM_OAUTH_COOKIE } from "@/server/connectors/instagram/oauth";

function settingsUrl(request: NextRequest, businessId: string | undefined, result: string) {
  const url = new URL("/settings", request.url);
  if (businessId) url.searchParams.set("business", businessId);
  url.searchParams.set("instagram", result);
  return url;
}

export async function GET(request: NextRequest) {
  const stored = parseInstagramOAuthCookie(request.cookies.get(INSTAGRAM_OAUTH_COOKIE)?.value);
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const result = (code: string) => {
    const response = NextResponse.redirect(settingsUrl(request, stored?.businessId, code));
    response.cookies.set(INSTAGRAM_OAUTH_COOKIE, "", { path: "/api/integrations/instagram", maxAge: 0 });
    return response;
  };
  if (!stored || !isMatchingOAuthState(state, stored.state)) return result("state_error");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: business } = await supabase.from("businesses").select("id")
    .eq("id", stored.businessId).eq("owner_id", user.id).maybeSingle();
  if (!business) return result("invalid_business");
  if (request.nextUrl.searchParams.get("error")) return result("denied");
  const code = request.nextUrl.searchParams.get("code");
  if (!code || !serverEnv.INSTAGRAM_APP_ID || !serverEnv.INSTAGRAM_APP_SECRET) return result("not_configured");

  const redirectUri = new URL("/api/integrations/instagram/callback", clientEnv.NEXT_PUBLIC_SITE_URL).toString();
  const outcome = await completeInstagramOAuth({
    userId: user.id,
    businessId: stored.businessId,
    appId: serverEnv.INSTAGRAM_APP_ID,
    appSecret: serverEnv.INSTAGRAM_APP_SECRET,
    redirectUri,
    code,
  });
  return result(outcome);
}
