import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env/client";
import { AUTH_PREFIXES, PROTECTED_PREFIXES, matchesPrefix } from "./route-access";

/** Refreshes the Supabase session cookie and gates protected routes. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getClaims() verifies the session's JWT against the project's published signing key (cached, no network round trip
  // on the production project, which uses asymmetric keys) and refreshes the session when it has expired. It is the
  // check Supabase recommends for a proxy; a project still on a shared secret falls back to asking the Auth server.
  // A suspended account is still stopped below: that check reads the profile on every request.
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims?.sub ? { id: claimsData.claims.sub } : null;

  // getClaims() may have refreshed the session and queued new auth cookies on `response`. A bare
  // NextResponse.redirect() would drop them: the browser keeps the old, already-rotated refresh
  // token and is signed out on its next request. Every redirect below carries them over.
  const redirectTo = (pathname: string, search?: Record<string, string>) => {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = pathname;
    redirectUrl.search = "";
    for (const [key, value] of Object.entries(search ?? {})) redirectUrl.searchParams.set(key, value);
    const redirect = NextResponse.redirect(redirectUrl);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  const { pathname } = request.nextUrl;
  const isProtected = matchesPrefix(pathname, PROTECTED_PREFIXES);
  const isAuthPage = matchesPrefix(pathname, AUTH_PREFIXES);

  if (user) {
    const { data: profile } = await supabase.from("profiles").select("account_status").eq("id", user.id).maybeSingle();
    const suspended = profile?.account_status === "SUSPENDED";
    if (suspended && pathname !== "/account-suspended") return redirectTo("/account-suspended");
    if (!suspended && pathname === "/account-suspended") return redirectTo("/dashboard");
  }

  if (!user && isProtected) return redirectTo("/login", { redirectTo: pathname });

  if (user && isAuthPage) return redirectTo("/dashboard");

  return response;
}
