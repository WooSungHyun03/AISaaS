import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database.types";
import { clientEnv } from "@/lib/env/client";

/**
 * Supabase client for Server Components, Server Actions, and Route
 * Handlers. Runs as the signed-in user (subject to RLS) via their session
 * cookie — never use this for privileged operations, see admin.ts.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component with no request/response to write
          // to — safe to ignore because middleware refreshes the session.
        }
      },
    },
  });
}

export interface AuthUser {
  id: string;
  email: string | undefined;
}

/**
 * The signed-in user for this request, for rendering pages. The session's JWT is verified against the project's
 * published signing key (`getClaims`: no round trip to Supabase Auth on the production project, which uses asymmetric
 * keys; a project on a shared secret falls back to asking the Auth server). `cache` makes the app layout and the page,
 * which render in parallel, share one check. Never cached across requests.
 *
 * Reads only: a Server Action that changes anything still calls `supabase.auth.getUser()` itself, which also notices a
 * session that was revoked on the server a moment ago.
 */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined };
});
