import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCreditBalances } from "@/server/billing/run-credits";
import { getUsageHistory } from "@/server/billing/read-model";
import { listEvents } from "@/server/calendar/events";
import { EVENT_CATEGORY_LABEL, type EventCategory } from "@/types/calendar-events";

export interface DashboardIdentity {
  displayName: string | null;
  business: { id: string; name: string } | null;
}

export interface DashboardCalendarItem {
  id: string;
  /** Seoul date (YYYY-MM-DD) of this occurrence. */
  date: string;
  /** "HH:mm" in Seoul time, or null for an all-day event. */
  time: string | null;
  title: string;
  categoryLabel: string;
  isRecurring: boolean;
}

export interface DashboardRecentContent {
  id: string;
  automationId: string;
  runId: string | null;
  contentType: string;
  title: string | null;
  topic: string | null;
  externalUrl: string | null;
  createdAt: string;
}

export interface DashboardProgress {
  channelCount: number;
  calendarCount: number;
  contentCount: number;
}

export type DashboardNextActionStage = "BUSINESS" | "CHANNEL" | "DIAGNOSIS" | "CALENDAR" | "CONTENT" | "GROWTH";

export interface DashboardNextAction {
  stage: DashboardNextActionStage;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
  href: string;
}

export function buildDashboardNextAction(input: {
  hasBusiness: boolean;
  channelCount: number;
  hasDiagnosis: boolean;
  calendarCount: number;
  contentCount: number;
}): DashboardNextAction {
  if (!input.hasBusiness) {
    return {
      stage: "BUSINESS",
      eyebrow: "시작 준비",
      title: "마케팅할 사업 정보를 먼저 알려주세요",
      description: "업체명과 업종을 입력하면 진단부터 블로그·숏폼 제작까지 사업에 맞게 준비해드려요.",
      cta: "사업 정보 입력하기",
      href: "/onboarding",
    };
  }
  if (input.channelCount === 0) {
    return {
      stage: "CHANNEL",
      eyebrow: "다음 추천 행동",
      title: "운영 중인 채널을 등록해보세요",
      description: "네이버 블로그, 티스토리 또는 유튜브 주소를 등록하면 현재 운영 상태를 확인할 수 있어요.",
      cta: "채널 등록하기",
      href: "/diagnosis",
    };
  }
  if (!input.hasDiagnosis) {
    return {
      stage: "DIAGNOSIS",
      eyebrow: "다음 추천 행동",
      title: "등록한 채널을 진단해보세요",
      description: "활동성, 꾸준함, 콘텐츠 상태를 확인하고 먼저 개선할 일을 찾아드려요.",
      cta: "마케팅 진단하기",
      href: "/diagnosis",
    };
  }
  if (input.calendarCount === 0) {
    return {
      stage: "CALENDAR",
      eyebrow: "다음 추천 행동",
      title: "캘린더에 첫 일정을 적어보세요",
      description: "콘텐츠를 올릴 날이나 이벤트, 휴무일을 적어두면 한눈에 챙길 수 있어요.",
      cta: "일정 추가하기",
      href: "/calendar",
    };
  }
  if (input.contentCount === 0) {
    return {
      stage: "CONTENT",
      eyebrow: "다음 추천 행동",
      title: "첫 콘텐츠를 만들어보세요",
      description: "블로그 글이나 숏폼 영상을 지금 바로 만들어볼 수 있어요.",
      cta: "첫 콘텐츠 만들기",
      href: "/blog",
    };
  }
  return {
    stage: "GROWTH",
    eyebrow: "다음 추천 행동",
    title: "최근 성장을 확인해보세요",
    description: "만든 콘텐츠와 채널 지표를 함께 보고 다음 주에 이어갈 활동을 결정해보세요.",
    cta: "성장 리포트 보기",
    href: "/growth-report",
  };
}

function currentKstMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

function monthRange(now = new Date()) {
  const { year, month } = currentKstMonth(now);
  const next = new Date(Date.UTC(year, month, 1));
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return { start, end };
}

export async function getDashboardIdentity(userId: string): Promise<DashboardIdentity> {
  const supabase = await createClient();
  const [profileResult, businessResult] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    supabase.from("businesses").select("id,name").eq("owner_id", userId).order("created_at").limit(1).maybeSingle(),
  ]);
  const error = profileResult.error || businessResult.error;
  if (error) throw new Error("대시보드 기본 정보를 불러오지 못했습니다.", { cause: error });
  return {
    displayName: profileResult.data?.display_name?.trim() || null,
    business: businessResult.data ?? null,
  };
}

/** The owner's coming events this month (repeats expanded), earliest first. */
export async function getDashboardCalendar(userId: string, now = new Date()) {
  const supabase = await createClient();
  const { start, end } = monthRange(now);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(now);
  const views = await listEvents(supabase, userId, start, end);
  const upcoming = views
    .filter((view) => (view.allDay ? view.end > today : view.end.slice(0, 10) >= today))
    .sort((a, b) => a.start.localeCompare(b.start));
  const items: DashboardCalendarItem[] = upcoming.slice(0, 6).map((view) => ({
    id: view.occurrenceId,
    date: view.start.slice(0, 10),
    time: view.allDay ? null : view.start.slice(11, 16),
    title: view.title,
    categoryLabel: EVENT_CATEGORY_LABEL[view.category as EventCategory],
    isRecurring: view.isRecurring,
  }));
  return { items, total: upcoming.length, month: start.slice(0, 7) };
}

export async function getDashboardCredits(userId: string) {
  const supabase = await createClient();
  return getCreditBalances(supabase, userId);
}

export async function getDashboardRecentContent(businessId: string, limit = 4): Promise<DashboardRecentContent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_history")
    .select("id,automation_id,run_id,content_type,title,topic,external_url,created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("최근 콘텐츠를 불러오지 못했습니다.", { cause: error });
  return (data ?? []).map((item) => ({
    id: item.id,
    automationId: item.automation_id,
    runId: item.run_id,
    contentType: item.content_type,
    title: item.title,
    topic: item.topic,
    externalUrl: item.external_url,
    createdAt: item.created_at,
  }));
}

export async function getDashboardRecentUsage(limit = 4) {
  const result = await getUsageHistory({ kind: null, status: null, from: null, to: null }, 1);
  return result.items.slice(0, limit);
}

export async function getDashboardProgress(businessId: string, userId: string): Promise<DashboardProgress> {
  const supabase = await createClient();
  const [channelsResult, calendarResult, contentResult] = await Promise.all([
    supabase.from("tracked_channels").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    supabase.from("calendar_events").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("content_history").select("id", { count: "exact", head: true }).eq("business_id", businessId),
  ]);
  const error = channelsResult.error || calendarResult.error || contentResult.error;
  if (error) throw new Error("대시보드 진행 상태를 불러오지 못했습니다.", { cause: error });
  return {
    channelCount: channelsResult.count ?? 0,
    calendarCount: calendarResult.count ?? 0,
    contentCount: contentResult.count ?? 0,
  };
}
