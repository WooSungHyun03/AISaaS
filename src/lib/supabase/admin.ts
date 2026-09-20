import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { clientEnv } from "@/lib/env/client";
import { requireEnv } from "@/lib/env/server";

/**
 * Service-role Supabase client. Bypasses Row Level Security entirely.
 *
 * Only use this from trusted server-only workflows that have already
 * authorized the operation themselves: the cron runner, billing webhooks,
 * and the directory sync job. Never use it to serve a normal user request —
 * use `@/lib/supabase/server` (RLS-scoped) for that.
 */
export function createAdminClient() {
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createSupabaseClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
