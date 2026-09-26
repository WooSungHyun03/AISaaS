import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";
import { createClient } from "@/lib/supabase/server";
import { buildInstagramAuthorizationUrl, INSTAGRAM_OAUTH_COOKIE } from "@/server/connectors/instagram/oauth";

function settingsUrl(request: NextRequest, businessId: string, result: string) {
  const url = new URL("/settings", request.url);
  if (businessId) url.searchParams.set("business", businessId);
  url.searchParams.set("instagram", result);
  return url;
}

export async function GET(request: NextRequest) {
  const businessId = request.nextUrl.searchParams.get("businessId") ?? "";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const { data: business } = await supabase.from("businesses").select("id")
    .eq("id", businessId).eq("owner_id", user.id).maybeSingle();
  if (!business) return NextResponse.redirect(settingsUrl(request, businessId, "invalid_business"));
  if (!serverEnv.INSTAGRAM_APP_ID || !serverEnv.INSTAGRAM_APP_SECRET) {
    return NextResponse.redirect(settingsUrl(request, businessId, "not_configured"));
  }

  const state = randomBytes(24).toString("base64url");
  const redirectUri = new URL("/api/integrations/instagram/callback", clientEnv.NEXT_PUBLIC_SITE_URL).toString();
  const authorizationUrl = buildInstagramAuthorizationUrl({ appId: serverEnv.INSTAGRAM_APP_ID, redirectUri, state });
  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(INSTAGRAM_OAUTH_COOKIE, Buffer.from(JSON.stringify({ state, businessId })).toString("base64url"), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/integrations/instagram",
    maxAge: 10 * 60,
  });
  return response;
}
