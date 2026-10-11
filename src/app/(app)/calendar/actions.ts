"use server";

import { createClient } from "@/lib/supabase/server";
import { triggerRunNow, type RunNowState } from "@/app/(app)/automations/actions";
import { canCreateAutomation } from "@/server/billing/entitlements";
import { AUTOMATION_AVAILABILITY, type AutomationSchedule } from "@/types/automation";
import type { BlogAutomationConfig } from "@/types/blog-automation";
import type { Json } from "@/types/domain";

type DbClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Finds the automation a calendar item should run through. An automation in
 * ACTIVE or DRAFT can be run on demand (the runner only refuses PAUSED/ERROR),
 * so a user who never set up a schedule can still go calendar -> content.
 * When none exists one is created as a DRAFT (never scheduled) from the
 * business profile and the calendar item itself, subject to the plan's
 * automation limit.
 */
async function resolveAutomationId(
  supabase: DbClient,
  userId: string,
  item: { business_id: string; platform: string; automation_id: string | null },
  templateSlug: "blog-marketing" | "shorts",
): Promise<{ automationId: string } | { error: string }> {
  if (item.automation_id) {
    const { data: linked } = await supabase
      .from("automations")
      .select("id")
      .eq("id", item.automation_id)
      .eq("user_id", userId)
      .eq("business_id", item.business_id)
      .in("status", ["ACTIVE", "DRAFT"])
      .maybeSingle();
    if (linked) return { automationId: linked.id };
  }

  const { data: template } = await supabase
    .from("automation_templates")
    .select("id")
    .eq("slug", templateSlug)
    .maybeSingle();
  if (!template) return { error: "콘텐츠 만들기 설정을 찾을 수 없습니다." };

  const { data: existing } = await supabase
    .from("automations")
    .select("id")
    .eq("user_id", userId)
    .eq("business_id", item.business_id)
    .eq("template_id", template.id)
    .in("status", ["ACTIVE", "DRAFT"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return { automationId: existing.id };

  const entitlement = await canCreateAutomation(supabase as never, userId);
  if (!entitlement.allowed) return { error: entitlement.reason ?? "지금은 만들기 설정을 더 만들 수 없습니다." };

  const { data: business } = await supabase
    .from("businesses")
    .select("id,name,keywords,brand_tone,marketing_goal")
    .eq("id", item.business_id)
    .eq("owner_id", userId)
    .maybeSingle();
  if (!business) return { error: "사업 정보를 찾을 수 없습니다." };

  const schedule: AutomationSchedule = { frequency: "WEEKLY", daysOfWeek: [1, 3, 5], timeOfDay: "09:00", timezone: "Asia/Seoul" };
  const config: Json = templateSlug === "blog-marketing"
    ? ({
      objective: (business.marketing_goal ?? `${business.name} 소개와 문의 늘리기`).slice(0, 300),
      keywords: (business.keywords.length ? business.keywords : [business.name]).slice(0, 12).map((keyword: string) => keyword.slice(0, 60)),
      tone: (business.brand_tone ?? "친근하고 전문적인").slice(0, 100),
      deliveryMode: "app_draft",
    } satisfies BlogAutomationConfig as unknown as Json)
    : { platforms: [] };

  const { data: created, error } = await supabase
    .from("automations")
    .insert({
      user_id: userId,
      business_id: business.id,
      template_id: template.id,
      name: `${business.name} ${templateSlug === "blog-marketing" ? "블로그" : "숏폼"}`,
      status: "DRAFT",
      schedule: schedule as unknown as Json,
      config,
    })
    .select("id")
    .single();
  if (error || !created) return { error: "콘텐츠 만들기 설정을 준비하지 못했습니다. 잠시 후 다시 시도해주세요." };
  return { automationId: created.id };
}

/**
 * Ticket 1-9: adds `automationId` to whatever `triggerRunNow` (not
 * modified) returns. A deferred run (`pending: true` — the blog handler's
 * outline-then-sections-then-fixes pipeline always defers after its first
 * step) only keeps moving via a cron tick or via <RunProgress> polling on
 * `/automations/{automationId}` while that page is open — and nothing
 * about triggering from the calendar dialog ever sent the user there.
 * `automationId` is what CalendarItemDialog needs to link to that page;
 * `triggerRunNow` itself has no reason to know it was called from a
 * calendar item, so this wraps its result here instead of changing its
 * return shape.
 */
export interface TriggerCalendarItemResult extends RunNowState {
  automationId?: string;
}

export async function triggerCalendarItemNow(calendarItemId: string): Promise<TriggerCalendarItemResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data: item, error: itemError } = await supabase
    .from("calendar_items")
    .select("id,business_id,planned_date,platform,status,automation_id")
    .eq("id", calendarItemId)
    .maybeSingle();
  if (itemError || !item) return { error: "캘린더 항목을 찾을 수 없습니다." };
  if (item.status !== "PLANNED") return { error: "이미 처리된 캘린더 항목입니다." };

  const templateSlug = item.platform === "blog"
    ? "blog-marketing"
    : item.platform === "youtube_shorts"
      ? "shorts"
      : null;
  if (!templateSlug) return { error: "인스타 릴스 제작은 준비 중입니다." };
  if (templateSlug === "shorts" && AUTOMATION_AVAILABILITY.shorts !== "AVAILABLE") {
    return { error: "유튜브 쇼츠 제작은 준비 중입니다." };
  }

  const resolved = await resolveAutomationId(supabase, user.id, item, templateSlug);
  if ("error" in resolved) return { error: resolved.error };

  const result = await triggerRunNow(resolved.automationId, item.id);
  return { ...result, automationId: resolved.automationId };
}

export interface CalendarItemActionState {
  error?: string;
}

/**
 * "건너뛰기" (ticket 1-9) — marks a still-PLANNED item SKIPPED without
 * generating anything. Reversible via unskipCalendarItem below; no new
 * migration needed since calendar_items_status_check (0030) already
 * allows 'SKIPPED', and the existing calendar_items_update_own RLS policy
 * (verified directly against the live DB: a non-owner's UPDATE affects 0
 * rows) already scopes this to the caller's own businesses.
 */
export async function skipCalendarItem(calendarItemId: string): Promise<CalendarItemActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data: updated, error } = await supabase
    .from("calendar_items")
    .update({ status: "SKIPPED" })
    .eq("id", calendarItemId)
    .eq("status", "PLANNED")
    .select("id")
    .maybeSingle();
  if (error) return { error: "건너뛰기 처리를 하지 못했습니다. 잠시 후 다시 시도해주세요." };
  if (!updated) return { error: "이미 처리된 캘린더 항목입니다." };
  return {};
}

/** Undoes skipCalendarItem — back to PLANNED, so a skipped item can be restored to the plan. */
export async function unskipCalendarItem(calendarItemId: string): Promise<CalendarItemActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data: updated, error } = await supabase
    .from("calendar_items")
    .update({ status: "PLANNED" })
    .eq("id", calendarItemId)
    .eq("status", "SKIPPED")
    .select("id")
    .maybeSingle();
  if (error) return { error: "되돌리기를 하지 못했습니다. 잠시 후 다시 시도해주세요." };
  if (!updated) return { error: "건너뛴 항목이 아니에요." };
  return {};
}

/**
 * "삭제" (ticket 1-9) — permanently removes a calendar item. The caller's
 * UI confirms with the user first (ConfirmationDialog); this action itself
 * performs no confirmation of its own. Allowed regardless of status: a
 * calendar_items row only schedules a plan, it's never the source of
 * truth for already-generated content (content_history/automation_runs
 * rows are untouched — calendar_items.content_history_id references them,
 * not the other way around).
 */
export async function deleteCalendarItem(calendarItemId: string): Promise<CalendarItemActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { error, count } = await supabase
    .from("calendar_items")
    .delete({ count: "exact" })
    .eq("id", calendarItemId);
  if (error) return { error: "삭제하지 못했습니다. 잠시 후 다시 시도해주세요." };
  if (!count) return { error: "캘린더 항목을 찾을 수 없습니다." };
  return {};
}
