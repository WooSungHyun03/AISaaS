import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { Business, BusinessFaq } from "@/types/domain";
import { serverEnv } from "@/lib/env/server";
import { logger } from "@/lib/logger";
import { answerSupportQuestion, QUESTION_MAX_LENGTH } from "./answer";
import { logSupportConversation } from "./conversations";
import { CustomerSupportError } from "./errors";

const REQUESTER_LIMIT = { maxRequests: 5, windowMinutes: 1 };
const WIDGET_LIMIT = { maxRequests: 60, windowMinutes: 10 };
const CLEANUP_MAX_AGE_MINUTES = 60;
/** ~1% of calls sweep old rows — cheap enough to run inline, no separate cron needed. */
const CLEANUP_PROBABILITY = 0.01;

const widgetChatRequestSchema = z.object({
  question: z.string().trim().min(1).max(QUESTION_MAX_LENGTH),
});

export type WidgetChatOutcome =
  | { status: "ok"; answer: string; isFallback: boolean }
  | { status: "invalid_input" }
  | { status: "widget_not_found" }
  | { status: "rate_limited" }
  | { status: "ai_unavailable" }
  | { status: "internal_error" };

/**
 * `widgetId` is the only thing an anonymous visitor sends — never
 * businesses.id. A malformed (non-uuid) value returns null without ever
 * touching the database.
 *
 * Not exported: this returns the FULL `Business` row, including `owner_id`
 * — safe for handleWidgetChatRequest's own use below (it only ever reads
 * `.id`/`.name`/`.industry` off it and never returns the row itself), but a
 * trap for any public-facing/client-component code that might naively pass
 * this whole object along and leak an internal uuid. Public-facing code
 * (the embed page) must go through getWidgetDisplayInfo instead, which
 * returns only fields safe to show.
 */
async function getBusinessByWidgetId(
  admin: SupabaseClient<Database>,
  widgetId: string,
): Promise<Business | null> {
  if (!z.string().uuid().safeParse(widgetId).success) return null;

  const { data, error } = await admin.from("businesses").select("*").eq("public_widget_id", widgetId).maybeSingle();

  if (error) {
    throw new CustomerSupportError("UNKNOWN", `Widget lookup failed for "${widgetId}": ${error.message}`, {
      cause: error,
    });
  }
  return data;
}

/**
 * Hashes a requester IP with a server secret (HMAC, not a plain hash) so it
 * can't be reversed via a precomputed table of all ~4 billion IPv4
 * addresses the way an unsalted sha256(ip) could be.
 *
 * Missing secret: allowed locally/in tests (returns null — the caller then
 * simply skips the requester-level rate limit, the widget-level limit still
 * applies) but refuses to quietly do the same in production, where a
 * missing secret would otherwise silently mean "no per-visitor rate limit
 * at all" with no signal that anything is wrong. This check is lazy
 * (inside the function body, only reached when a real request comes in) —
 * not at module load / env-schema time — specifically because `next build`
 * also runs with NODE_ENV=production, and a load-time check would fail
 * every local production build, not just a real deployment missing the
 * secret.
 */
export function hashRequesterIp(ip: string): string | null {
  const secret = serverEnv.SUPPORT_WIDGET_IP_HASH_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SUPPORT_WIDGET_IP_HASH_SECRET is required in production (used to hash CS widget requester IPs for rate limiting) — set it in your deployment environment.",
      );
    }
    return null;
  }

  return createHmac("sha256", secret).update(ip).digest("hex");
}

async function countRecentRequests(
  admin: SupabaseClient<Database>,
  filters: { businessId: string; requesterHash?: string },
  windowMinutes: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  let query = admin
    .from("support_widget_requests")
    .select("*", { count: "exact", head: true })
    .eq("business_id", filters.businessId)
    .gte("requested_at", since);
  if (filters.requesterHash) query = query.eq("requester_hash", filters.requesterHash);

  const { count, error } = await query;
  if (error) {
    throw new CustomerSupportError("UNKNOWN", `Rate limit count failed: ${error.message}`, { cause: error });
  }
  return count ?? 0;
}

/** Best-effort — a cleanup failure must never block a real rate-limit decision. */
async function maybeCleanupOldRequests(admin: SupabaseClient<Database>): Promise<void> {
  if (Math.random() >= CLEANUP_PROBABILITY) return;

  const cutoff = new Date(Date.now() - CLEANUP_MAX_AGE_MINUTES * 60_000).toISOString();
  const { error } = await admin.from("support_widget_requests").delete().lt("requested_at", cutoff);
  if (error) {
    logger.warn("support_widget_requests_cleanup_failed", { message: error.message });
  }
}

/**
 * Checks both the per-requester and per-widget limits and, only if both
 * pass, records this request (so a rejected request doesn't itself consume
 * a slot). Counting then inserting isn't wrapped in a single atomic
 * transaction — at this endpoint's expected traffic (one small business's
 * CS widget, not a high-throughput public API) an occasional request
 * slipping through a race is an acceptable trade-off against the
 * complexity of an advisory lock here.
 */
export async function checkAndRecordRateLimit(
  admin: SupabaseClient<Database>,
  businessId: string,
  requesterHash: string | null,
): Promise<{ allowed: boolean }> {
  await maybeCleanupOldRequests(admin);

  const widgetCount = await countRecentRequests(admin, { businessId }, WIDGET_LIMIT.windowMinutes);
  if (widgetCount >= WIDGET_LIMIT.maxRequests) return { allowed: false };

  if (requesterHash) {
    const requesterCount = await countRecentRequests(
      admin,
      { businessId, requesterHash },
      REQUESTER_LIMIT.windowMinutes,
    );
    if (requesterCount >= REQUESTER_LIMIT.maxRequests) return { allowed: false };
  }

  const { error } = await admin
    .from("support_widget_requests")
    .insert({ business_id: businessId, requester_hash: requesterHash });
  if (error) {
    throw new CustomerSupportError("UNKNOWN", `Failed to record widget request: ${error.message}`, { cause: error });
  }

  return { allowed: true };
}

/** Admin client, scoped by `business_id` on every query — see widget.ts's ticket report for why that's safe without RLS. */
export async function getEnabledFaqsForBusiness(
  admin: SupabaseClient<Database>,
  businessId: string,
): Promise<BusinessFaq[]> {
  const { data, error } = await admin
    .from("business_faqs")
    .select("*")
    .eq("business_id", businessId)
    .eq("is_enabled", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new CustomerSupportError("UNKNOWN", `Failed to load FAQs for business ${businessId}: ${error.message}`, {
      cause: error,
    });
  }
  return data ?? [];
}

/** Safe-to-show message + HTTP status for every non-"ok" outcome — the one place this mapping is defined. */
export function describeWidgetChatError(status: Exclude<WidgetChatOutcome["status"], "ok">): {
  httpStatus: number;
  message: string;
} {
  switch (status) {
    case "invalid_input":
      return { httpStatus: 400, message: "질문 내용을 확인해주세요." };
    case "widget_not_found":
      return { httpStatus: 404, message: "요청하신 위젯을 찾을 수 없습니다." };
    case "rate_limited":
      return { httpStatus: 429, message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." };
    case "ai_unavailable":
      return { httpStatus: 503, message: "일시적으로 답변을 생성할 수 없습니다. 잠시 후 다시 시도해주세요." };
    case "internal_error":
      return { httpStatus: 500, message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." };
  }
}

/**
 * The one entry point the (Dev2-owned) Route Handler calls. Order matters:
 * input validation -> widget lookup -> rate limit -> FAQ fetch -> AI call —
 * an invalid request or an unknown widget never touches
 * support_widget_requests (doesn't consume a rate-limit slot for garbage
 * input), and a rate-limited request never reaches the AI call (no cost
 * incurred for a request we're already rejecting).
 *
 * Never throws — every failure, expected or not, becomes a typed outcome so
 * the Route Handler can stay a dumb switch statement with no business logic
 * of its own, and no internal error detail (message, stack, cause) ever has
 * a path to the HTTP response.
 */
export async function handleWidgetChatRequest(
  admin: SupabaseClient<Database>,
  widgetId: string,
  rawBody: unknown,
  requesterIp: string | null,
): Promise<WidgetChatOutcome> {
  try {
    const parsedBody = widgetChatRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) return { status: "invalid_input" };

    const business = await getBusinessByWidgetId(admin, widgetId);
    if (!business) return { status: "widget_not_found" };

    const requesterHash = requesterIp ? hashRequesterIp(requesterIp) : null;
    const { allowed } = await checkAndRecordRateLimit(admin, business.id, requesterHash);
    if (!allowed) return { status: "rate_limited" };

    const faqs = await getEnabledFaqsForBusiness(admin, business.id);

    try {
      const result = await answerSupportQuestion(business, faqs, parsedBody.data.question);

      // Best-effort — a logging failure must never fail the chat response
      // the customer is waiting on (see conversations.ts's own docs on this).
      try {
        await logSupportConversation(admin, business.id, parsedBody.data.question, result);
      } catch (logErr) {
        logger.warn("widget_chat_log_failed", {
          businessId: business.id,
          message: logErr instanceof Error ? logErr.message : String(logErr),
        });
      }

      return { status: "ok", answer: result.answer, isFallback: result.isFallback };
    } catch (err) {
      logger.error("widget_chat_ai_failed", {
        businessId: business.id,
        message: err instanceof Error ? err.message : String(err),
      });
      return { status: "ai_unavailable" };
    }
  } catch (err) {
    logger.error("widget_chat_internal_error", { message: err instanceof Error ? err.message : String(err) });
    return { status: "internal_error" };
  }
}

/** Only the fields safe to show on the public embed page — never `id`/`owner_id`/anything else internal. */
export interface WidgetDisplayInfo {
  businessName: string;
}

/** What the (Dev2-owned) `/widget/[widgetId]` page calls to render its header, or a "not found" state if null. */
export async function getWidgetDisplayInfo(
  admin: SupabaseClient<Database>,
  widgetId: string,
): Promise<WidgetDisplayInfo | null> {
  const business = await getBusinessByWidgetId(admin, widgetId);
  if (!business) return null;
  return { businessName: business.name };
}

const DEFAULT_WIDGET_WIDTH = 380;
const DEFAULT_WIDGET_HEIGHT = 600;

/** Minimal HTML-attribute/text escaping — `businessName` is user-entered and lands inside an HTML attribute below. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The one formula for this widget's embed URL — every caller (the snippet
 * generator below, docs, tests) builds it the same way. `siteUrl` is passed
 * in rather than read from env here so this stays a pure, easily-testable
 * function; callers pass `clientEnv.NEXT_PUBLIC_SITE_URL`.
 */
export function buildWidgetEmbedUrl(siteUrl: string, publicWidgetId: string): string {
  return `${siteUrl}/widget/${publicWidgetId}`;
}

/**
 * The `<iframe>` HTML a business owner copies into their own site (shown on
 * their settings page, Dev2 territory). `sandbox` is intentionally omitted:
 * this project has no existing sandboxed-iframe precedent to follow, and
 * the widget page itself needs `allow-scripts`/`allow-forms`/`allow-same-origin`
 * for basic chat functionality anyway — worth a dedicated look later rather
 * than guessing a value here.
 */
export function buildWidgetEmbedSnippet(siteUrl: string, publicWidgetId: string, businessName: string): string {
  const src = buildWidgetEmbedUrl(siteUrl, publicWidgetId);
  const title = escapeHtml(`${businessName} 고객 지원 챗봇`);

  return `<iframe src="${src}" title="${title}" width="${DEFAULT_WIDGET_WIDTH}" height="${DEFAULT_WIDGET_HEIGHT}" loading="lazy" style="border:none;"></iframe>`;
}
