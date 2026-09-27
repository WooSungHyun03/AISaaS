import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Subscriber } from "@/types/domain";

type AdminClient = SupabaseClient<Database>;

/**
 * Subscribers a newsletter send should actually reach — `subscribers` rows
 * for this business with status ACTIVE only (never UNSUBSCRIBED). Always
 * called with the service-role client (bypasses RLS) from the automation
 * runner path; a future owner-facing subscriber list page would go through
 * a Server Action using the RLS-scoped client and this table's own
 * owner-scoped policies instead (see supabase/migrations/0026_subscribers.sql).
 */
export async function listActiveSubscribers(admin: AdminClient, businessId: string): Promise<Pick<Subscriber, "id" | "email" | "name">[]> {
  const { data, error } = await admin
    .from("subscribers")
    .select("id, email, name")
    .eq("business_id", businessId)
    .eq("status", "ACTIVE");
  if (error) throw error;
  return data ?? [];
}
