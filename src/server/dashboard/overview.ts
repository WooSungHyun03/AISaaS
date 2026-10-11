import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getCreditBalances } from "@/server/billing/run-credits";
import { getUsageHistory } from "@/server/billing/read-model";

export interface DashboardIdentity {
  displayName: string | null;
  business: { id: string; name: string } | null;
}

export interface DashboardCalendarItem {
  id: string;
  plannedDate: string;
  platform: "blog" | "instagram_reels" | "youtube_shorts";
  topic: string;
  status: "PLANNED" | "GENERATED" | "PUBLISHED" | "SKIPPED";
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
      description: "업체명과 업종을 입력하면 진단부터 콘텐츠 계획까지 사업에 맞게 준비해드려요.",
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
      title: "이번 달 콘텐츠 계획을 만들어보세요",
      description: "진단 결과와 사업 정보를 바탕으로 날짜별 블로그·숏폼 주제를 계획해드려요.",
      cta: "캘린더 만들기",
      href: "/calendar",
    };
  }
  if (input.contentCount === 0) {
    return {
      stage: "CONTENT",
      eyebrow: "다음 추천 행동",
      title: "계획한 첫 콘텐츠를 만들어보세요",
      description: "캘린더에서 오늘의 주제를 골라 블로그 글이나 숏폼을 바로 만들 수 있어요.",
      cta: "첫 콘텐츠 만들기",
      href: "/calendar",
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

export async function getDashboardCalendar(businessId: string, now = new Date()) {
  const supabase = await createClient();
  const { start, end } = monthRange(now);
  const { data, error, count } = await supabase
    .from("calendar_items")
    .select("id,planned_date,platform,topic,status", { count: "exact" })
    .eq("business_id", businessId)
    .gte("planned_date", start)
    .lt("planned_date", end)
    .order("planned_date")
    .limit(6);
  if (error) throw new Error("이번 달 캘린더를 불러오지 못했습니다.", { cause: error });
  const items: DashboardCalendarItem[] = (data ?? []).map((item) => ({
    id: item.id,
    plannedDate: item.planned_date,
    platform: item.platform,
    topic: item.topic,
    status: item.status,
  }));
  return { items, total: count ?? 0, month: start.slice(0, 7) };
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

export async function getDashboardProgress(businessId: string): Promise<DashboardProgress> {
  const supabase = await createClient();
  const [channelsResult, calendarResult, contentResult] = await Promise.all([
    supabase.from("tracked_channels").select("id", { count: "exact", head: true }).eq("business_id", businessId),
    supabase.from("calendar_items").select("id", { count: "exact", head: true }).eq("business_id", businessId),
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
