import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Business } from "@/types/domain";

export interface ReadinessScoreRow {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
  href: string;
  cta: string;
  todo: string;
  points: number;
  max: number;
}

export interface ReadinessScoreResult {
  businessId: string;
  score: number;
  rows: ReadinessScoreRow[];
  /** First not-yet-ready row, in display order — null once every row is ready. */
  nextTodo: ReadinessScoreRow | null;
}

function isInstagramConnected(status: string | undefined): boolean {
  return status === "CONNECTED";
}

/**
 * "마케팅 운영 준비 점수" — 저장된 사업 정보/연결 상태/최근 제작 기록만으로 계산한
 * 운영 준비도. 홈페이지 콘텐츠 자체의 품질 점수(diagnoseWebsite, /diagnosis의
 * "홈페이지로 자동 채우기")와는 다른 지표라 섞어 쓰지 않는다.
 *
 * Ticket 1-5: /marketing/diagnosis 페이지에 있던 계산을 그대로 옮긴 것 —
 * 점수 산식은 바뀌지 않았다. 사람 2의 /dashboard에서도 쓸 수 있도록
 * src/server/marketing으로 추출했다 (docs/person1/READINESS_SCORE_FOR_DASHBOARD.md 참고).
 */
export async function getReadinessScore(business: Business, userId: string): Promise<ReadinessScoreResult> {
  const supabase = await createClient();

  const [{ data: connections, error: connectionError }, { data: automations, error: automationError }] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("provider, status, account_identifier")
      .eq("user_id", userId)
      .eq("business_id", business.id)
      .neq("status", "DISCONNECTED"),
    supabase
      .from("automations")
      .select("id, name, status, template_id, last_run_at, next_run_at")
      .eq("user_id", userId)
      .eq("business_id", business.id),
  ]);
  const readError = connectionError || automationError;
  if (readError) throw new Error("마케팅 준비 점수를 불러오지 못했습니다.", { cause: readError });

  const automationIds = (automations ?? []).map((automation) => automation.id);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const recentSuccessResult = automationIds.length
    ? await supabase
      .from("automation_runs")
      .select("id", { count: "exact", head: true })
      .in("automation_id", automationIds)
      .eq("status", "SUCCESS")
      .gte("created_at", thirtyDaysAgo.toISOString())
    : { count: 0, error: null };
  if (recentSuccessResult.error) throw new Error("최근 콘텐츠 운영 기록을 불러오지 못했습니다.", { cause: recentSuccessResult.error });

  const instagram = connections?.find((connection) => connection.provider === "instagram");
  const hasInstagram = isInstagramConnected(instagram?.status);
  const activeAutomations = (automations ?? []).filter((automation) => automation.status === "ACTIVE");
  const recentSuccesses = recentSuccessResult.count ?? 0;

  const profileFields = [business.industry, business.description, business.location, business.target_customer, business.brand_tone, business.keywords.length ? "keywords" : null];
  const completedProfileFields = profileFields.filter(Boolean).length;
  const profileScore = Math.round((completedProfileFields / profileFields.length) * 30);

  const score = profileScore + (business.website ? 20 : 0) + (hasInstagram ? 20 : 0) + (activeAutomations.length ? 15 : 0) + (recentSuccesses ? 15 : 0);

  const rows: ReadinessScoreRow[] = [
    {
      key: "profile",
      label: "사업 정보",
      ready: completedProfileFields >= 4,
      detail: `${completedProfileFields}/${profileFields.length}개 항목을 입력했어요`,
      href: "/business",
      cta: "정보 채우기",
      todo: "사업 정보를 더 채우는 것",
      points: profileScore,
      max: 30,
    },
    {
      key: "website",
      label: "홈페이지",
      ready: Boolean(business.website),
      detail: business.website ?? "등록된 주소가 없어요",
      href: "/business",
      cta: "주소 등록",
      todo: "홈페이지 주소를 등록하는 것",
      points: business.website ? 20 : 0,
      max: 20,
    },
    {
      key: "instagram",
      label: "Instagram",
      ready: hasInstagram,
      detail: hasInstagram ? (instagram?.account_identifier ?? "계정이 연결돼 있어요") : "연결된 계정이 없어요",
      href: `/settings?business=${business.id}`,
      cta: "계정 연결",
      todo: "Instagram 계정을 연결하는 것",
      points: hasInstagram ? 20 : 0,
      max: 20,
    },
    {
      key: "automation_setup",
      label: "콘텐츠 만들기 설정",
      ready: activeAutomations.length > 0,
      detail: activeAutomations.length ? `진행 중인 설정 ${activeAutomations.length}개` : "켜 둔 설정이 없어요",
      href: "/automations/marketplace",
      cta: "설정하기",
      todo: "콘텐츠 만들기를 설정하는 것",
      points: activeAutomations.length ? 15 : 0,
      max: 15,
    },
    {
      key: "recent_output",
      label: "최근 30일 제작",
      ready: recentSuccesses > 0,
      detail: recentSuccesses ? `콘텐츠 ${recentSuccesses}개를 만들었어요` : "만든 콘텐츠가 아직 없어요",
      href: "/automations/marketplace",
      cta: "만들어보기",
      todo: "첫 콘텐츠를 만들어보는 것",
      points: recentSuccesses ? 15 : 0,
      max: 15,
    },
  ];

  return { businessId: business.id, score, rows, nextTodo: rows.find((row) => !row.ready) ?? null };
}
