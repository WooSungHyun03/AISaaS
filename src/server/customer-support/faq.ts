import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Faq } from "@/types/domain";

/** Public read for the Guides/FAQ page. Dev3: extend with search/category filters as needed. */
export async function listPublishedFaqs(supabase: SupabaseClient<Database>): Promise<Faq[]> {
  const { data, error } = await supabase
    .from("faqs")
    .select("*")
    .eq("is_published", true)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}
