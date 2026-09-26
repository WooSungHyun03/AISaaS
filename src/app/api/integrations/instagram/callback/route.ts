import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createConnection, getConnection, updateConnectionStatus } from "@/server/connectors/integrations";
import { exchangeInstagramCode, getInstagramProfile, INSTAGRAM_OAUTH_COOKIE, isProfessionalInstagramAccount } from "@/server/connectors/instagram/oauth";

interface OAuthCookie { state: string; businessId: string }

function parseOAuthCookie(value: string | undefined): OAuthCookie | null {
  try {
    const parsed = JSON.parse(Buffer.from(value ?? "", "base64url").toString("utf8")) as OAuthCookie;
    return parsed.state && parsed.businessId ? parsed : null;
  } catch { return null; }
}

function equalState(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function settingsUrl(request: NextRequest, businessId: string | undefined, result: string) {
  const url = new URL("/settings", request.url);
  if (businessId) url.searchParams.set("business", businessId);
  url.searchParams.set("instagram", result);
  return url;
}

async function markExistingConnectionError(userId: string, businessId: string) {
  try {
    const admin = createAdminClient();
    const connection = await getConnection(admin, userId, businessId, "instagram");
    if (connection) await updateConnectionStatus(admin, connection.id, "ERROR");
  } catch { /* The redirect message remains the source of truth for this attempt. */ }
}

export async function GET(request: NextRequest) {
  const stored = parseOAuthCookie(request.cookies.get(INSTAGRAM_OAUTH_COOKIE)?.value);
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const result = (code: string) => {
    const response = NextResponse.redirect(settingsUrl(request, stored?.businessId, code));
    response.cookies.set(INSTAGRAM_OAUTH_COOKIE, "", { path: "/api/integrations/instagram", maxAge: 0 });
    return response;
  };
  if (!stored || !equalState(state, stored.state)) return result("state_error");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  const { data: business } = await supabase.from("businesses").select("id")
    .eq("id", stored.businessId).eq("owner_id", user.id).maybeSingle();
  if (!business) return result("invalid_business");
  if (request.nextUrl.searchParams.get("error")) return result("denied");
  const code = request.nextUrl.searchParams.get("code");
  if (!code || !serverEnv.INSTAGRAM_APP_ID || !serverEnv.INSTAGRAM_APP_SECRET) return result("not_configured");

  try {
    const redirectUri = new URL("/api/integrations/instagram/callback", clientEnv.NEXT_PUBLIC_SITE_URL).toString();
    const token = await exchangeInstagramCode({
      appId: serverEnv.INSTAGRAM_APP_ID,
      appSecret: serverEnv.INSTAGRAM_APP_SECRET,
      redirectUri,
      code,
    });
    const profile = await getInstagramProfile(token.accessToken);
    if (!isProfessionalInstagramAccount(profile.accountType)) return result("professional_required");

    const metadata: Record<string, string> = { accountId: profile.id, accountType: profile.accountType };
    if (token.expiresIn) metadata.expiresAt = new Date(Date.now() + token.expiresIn * 1000).toISOString();
    await createConnection({
      userId: user.id,
      businessId: stored.businessId,
      provider: "instagram",
      accountIdentifier: `@${profile.username}`,
      secret: token.accessToken,
      metadata,
    });
    return result("connected");
  } catch {
    await markExistingConnectionError(user.id, stored.businessId);
    return result("error");
  }
}
