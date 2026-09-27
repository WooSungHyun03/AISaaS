import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database.types";
import type { SupportConversation } from "@/types/domain";
import type { SupportAnswer } from "./answer";
import { CustomerSupportError } from "./errors";

const MAX_PAGE_SIZE = 50;

/**
 * Unlike search.ts's public-facing schema, this is called only from
 * trusted internal code (a business owner's own dashboard query) with
 * already-typed values, not raw untyped URL search params — so plain
 * `.default()` is fine here; there's no adversarial input to defend
 * against with `.catch()`.
 */
const conversationLogQuerySchema = z.object({
  onlyFallback: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type ConversationLogQuery = z.input<typeof conversationLogQuerySchema>;

export interface ConversationLogResult {
  conversations: SupportConversation[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Logs one widget Q&A exchange. `businessId` must come from the row
 * `getBusinessByWidgetId` already looked up (see widget.ts) — never from
 * anything the anonymous caller sent directly, since a widget request only
 * ever carries a `public_widget_id`, not a business_id.
 *
 * Throws on failure rather than swallowing it — the caller
 * (handleWidgetChatRequest) decides to catch this and log-and-ignore so a
 * logging failure never fails the actual chat response; this function
 * itself doesn't make that call silently.
 */
export async function logSupportConversation(
  admin: SupabaseClient<Database>,
  businessId: string,
  question: string,
  result: Pick<SupportAnswer, "answer" | "isFallback" | "usedFaqIds">,
): Promise<void> {
  const { error } = await admin.from("support_conversations").insert({
    business_id: businessId,
    question,
    answer: result.answer,
    used_faq_ids: result.usedFaqIds,
    is_fallback: result.isFallback,
  });

  if (error) {
    throw new CustomerSupportError(
      "UNKNOWN",
      `Failed to log conversation for business ${businessId}: ${error.message}`,
      { cause: error },
    );
  }
}

/**
 * A business owner's paginated view of their own conversation log.
 * `used_faq_ids` is returned exactly as stored — this never joins against
 * `business_faqs` to resolve those ids into full FAQ rows, so a FAQ being
 * deleted later has no way to break this query (there's nothing to fail to
 * find; the id array is just data, not a live reference).
 *
 * `supabase` must be the RLS-scoped client — `support_conversations_select_own`
 * is what actually enforces "own business only", this function just runs
 * the query (same pattern as listFaqsForBusiness in faq.ts).
 */
export async function listConversationsForBusiness(
  supabase: SupabaseClient<Database>,
  businessId: string,
  rawQuery: ConversationLogQuery = {},
): Promise<ConversationLogResult> {
  const { onlyFallback, page, pageSize } = conversationLogQuerySchema.parse(rawQuery);

  let query = supabase.from("support_conversations").select("*", { count: "exact" }).eq("business_id", businessId);
  if (onlyFallback !== undefined) query = query.eq("is_fallback", onlyFallback);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);

  if (error) {
    throw new CustomerSupportError(
      "UNKNOWN",
      `Failed to list conversations for business ${businessId}: ${error.message}`,
      { cause: error },
    );
  }

  return { conversations: data ?? [], total: count ?? 0, page, pageSize };
}

/**
 * Lets an owner delete a log row — a customer's free-text question can
 * incidentally contain personal info they volunteered (phone number, name),
 * so this needs to exist even though the log has no edit path. RLS
 * (`support_conversations_delete_own`) is what actually enforces ownership;
 * 0 rows deleted (not owned, or already gone) is reported the same way as
 * every other CRUD function in this domain — NOT_FOUND, no distinction.
 */
export async function deleteSupportConversation(supabase: SupabaseClient<Database>, id: string): Promise<void> {
  const { data, error } = await supabase.from("support_conversations").delete().eq("id", id).select().maybeSingle();

  if (error) {
    throw new CustomerSupportError("UNKNOWN", `Failed to delete conversation ${id}: ${error.message}`, {
      cause: error,
    });
  }
  if (!data) {
    throw new CustomerSupportError("NOT_FOUND", `No conversation found for id "${id}".`);
  }
}
