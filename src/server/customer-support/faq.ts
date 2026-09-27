import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { BusinessFaq, Faq } from "@/types/domain";
import {
  createBusinessFaqSchema,
  updateBusinessFaqSchema,
  type CreateBusinessFaqInput,
  type UpdateBusinessFaqInput,
} from "@/types/customer-support";
import { CustomerSupportError } from "./errors";

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

/**
 * A business owner's management view of their own FAQs — returns
 * everything regardless of `is_enabled` (a disabled FAQ still needs to show
 * up here so it can be re-enabled). The future CS answer engine (#9) reads
 * a separately-filtered `is_enabled = true` view, not this function.
 *
 * `supabase` must be the RLS-scoped client (`createClient()`) — RLS is what
 * actually enforces "own business only" here, this function just runs the
 * query.
 */
export async function listFaqsForBusiness(
  supabase: SupabaseClient<Database>,
  businessId: string,
): Promise<BusinessFaq[]> {
  const { data, error } = await supabase
    .from("business_faqs")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new CustomerSupportError("UNKNOWN", `Failed to list FAQs for business ${businessId}: ${error.message}`, {
      cause: error,
    });
  }
  return data ?? [];
}

/**
 * Creates a FAQ under `input.businessId`. That value is never trusted on
 * its own — the table's `business_faqs_insert_own` RLS policy (an `exists
 * (select 1 from businesses where id = business_id and owner_id =
 * auth.uid())` check) re-verifies ownership inside Postgres regardless of
 * what this function is called with, so a caller can't insert a row under a
 * business_id they don't own even if they somehow bypass this function's
 * own validation. This only works because `supabase` here is the
 * RLS-scoped client — never call this with the service-role client.
 */
export async function createBusinessFaq(
  supabase: SupabaseClient<Database>,
  rawInput: CreateBusinessFaqInput,
): Promise<BusinessFaq> {
  const input = createBusinessFaqSchema.parse(rawInput);

  const { data, error } = await supabase
    .from("business_faqs")
    .insert({ business_id: input.businessId, question: input.question, answer: input.answer })
    .select()
    .single();

  if (error) {
    throw new CustomerSupportError("UNKNOWN", `Failed to create FAQ: ${error.message}`, { cause: error });
  }
  return data;
}

/**
 * Updates question/answer/isEnabled only — `business_id` can't be changed
 * through this function (see updateBusinessFaqSchema). A row that doesn't
 * exist *or* isn't owned by the caller both come back as zero rows matched
 * (RLS filters silently, it doesn't error) — both cases are reported as the
 * same NOT_FOUND so a caller can't use this to probe whether some other
 * business's FAQ id exists.
 */
export async function updateBusinessFaq(
  supabase: SupabaseClient<Database>,
  id: string,
  rawInput: UpdateBusinessFaqInput,
): Promise<BusinessFaq> {
  const input = updateBusinessFaqSchema.parse(rawInput);

  const patch: Database["public"]["Tables"]["business_faqs"]["Update"] = {
    ...(input.question !== undefined ? { question: input.question } : {}),
    ...(input.answer !== undefined ? { answer: input.answer } : {}),
    ...(input.isEnabled !== undefined ? { is_enabled: input.isEnabled } : {}),
  };

  const { data, error } = await supabase.from("business_faqs").update(patch).eq("id", id).select().maybeSingle();

  if (error) {
    throw new CustomerSupportError("UNKNOWN", `Failed to update FAQ ${id}: ${error.message}`, { cause: error });
  }
  if (!data) {
    throw new CustomerSupportError("NOT_FOUND", `No FAQ found for id "${id}".`);
  }
  return data;
}

/** Same "0 rows = NOT_FOUND, missing and not-yours look identical" rule as updateBusinessFaq. */
export async function deleteBusinessFaq(supabase: SupabaseClient<Database>, id: string): Promise<void> {
  const { data, error } = await supabase.from("business_faqs").delete().eq("id", id).select().maybeSingle();

  if (error) {
    throw new CustomerSupportError("UNKNOWN", `Failed to delete FAQ ${id}: ${error.message}`, { cause: error });
  }
  if (!data) {
    throw new CustomerSupportError("NOT_FOUND", `No FAQ found for id "${id}".`);
  }
}
