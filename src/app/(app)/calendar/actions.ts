"use server";

import { createClient } from "@/lib/supabase/server";
import { triggerRunNow, type RunNowState } from "@/app/(app)/automations/actions";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";

function currentKstDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function triggerCalendarItemNow(calendarItemId: string): Promise<RunNowState> {
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
  if (item.planned_date !== currentKstDate()) return { error: "예정일이 오늘인 콘텐츠만 바로 생성할 수 있습니다." };

  const templateSlug = item.platform === "blog"
    ? "blog-marketing"
    : item.platform === "youtube_shorts"
      ? "shorts"
      : null;
  if (!templateSlug) return { error: "Instagram 릴스는 캘린더 생성 연결을 준비 중입니다." };
  if (templateSlug === "shorts" && AUTOMATION_AVAILABILITY.shorts !== "AVAILABLE") {
    return { error: "YouTube Shorts 자동화는 Coming Soon입니다." };
  }

  let automationId = item.automation_id;
  if (automationId) {
    const { data: linkedAutomation } = await supabase
      .from("automations")
      .select("id")
      .eq("id", automationId)
      .eq("user_id", user.id)
      .eq("business_id", item.business_id)
      .eq("status", "ACTIVE")
      .maybeSingle();
    automationId = linkedAutomation?.id ?? null;
  }

  if (!automationId) {
    const { data: template } = await supabase
      .from("automation_templates")
      .select("id")
      .eq("slug", templateSlug)
      .maybeSingle();
    if (!template) return { error: "자동화 템플릿을 찾을 수 없습니다." };

    const { data: automation } = await supabase
      .from("automations")
      .select("id")
      .eq("user_id", user.id)
      .eq("business_id", item.business_id)
      .eq("template_id", template.id)
      .eq("status", "ACTIVE")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    automationId = automation?.id ?? null;
  }

  if (!automationId) {
    const label = item.platform === "blog" ? "블로그" : "Shorts";
    return { error: `${label} 자동화를 먼저 만들고 활성화해주세요.` };
  }

  return triggerRunNow(automationId, item.id);
}
