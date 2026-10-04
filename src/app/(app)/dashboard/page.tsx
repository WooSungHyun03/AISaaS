import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Check, CircleCheck, CircleX, PlayCircle, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPlanConfig } from "@/server/billing/plans";
import { PLAN_LABEL } from "@/components/billing/plan-copy";
import { getPeriodKey, SERVICE_TIMEZONE, zonedTimeToUtc } from "@/lib/utils/date";
import { StatCard, StatGroup } from "@/components/dashboard/stat-card";
import { Mascot } from "@/components/brand/mascot";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { AutomationRun } from "@/types/domain";
import { getRecentSetupRequests } from "@/server/setup-requests";
import { SetupRequestStatusBadge } from "@/components/setup-requests/setup-request-status";
import { SETUP_REQUEST_STATUS, setupAutomationTypeLabel, setupRequestNumber } from "@/types/setup-request";
import { EmptyState } from "@/components/ui/page-state";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

const RUN_STATUS_LABEL = {
  QUEUED: "대기 중",
  RUNNING: "만드는 중",
  SUCCESS: "완료",
  FAILED: "실패",
} as const;

type RecentRun = Pick<AutomationRun, "id" | "automation_id" | "status" | "created_at" | "error_message">;

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const periodKey = getPeriodKey();
  const [year, month] = periodKey.split("-").map(Number);

  const [businessResult, automationResult, subscriptionResult, usageResult, setupRequests, profileResult] = await Promise.all([
    supabase.from("businesses").select("id").eq("owner_id", user.id).limit(1).maybeSingle(),
    supabase.from("automations").select("id, name, status, next_run_at").eq("user_id", user.id),
    supabase.from("subscriptions").select("plan, status").eq("user_id", user.id).maybeSingle(),
    supabase.from("usage").select("automation_runs").eq("user_id", user.id).eq("period", periodKey).maybeSingle(),
    getRecentSetupRequests(user.id),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);

  const readError = businessResult.error || automationResult.error || subscriptionResult.error || usageResult.error;
  if (readError) throw new Error("대시보드 데이터를 불러오지 못했습니다.", { cause: readError });

  const automations = automationResult.data ?? [];
  const automationIds = automations.map((automation) => automation.id);
  const automationNames = new Map(automations.map((automation) => [automation.id, automation.name]));
  let recentRuns: RecentRun[] = [];
  let monthlyRuns = 0;

  if (automationIds.length) {
    const [recentResult, countResult] = await Promise.all([
      supabase.from("automation_runs")
        .select("id, automation_id, status, created_at, error_message")
        .in("automation_id", automationIds)
        .order("created_at", { ascending: false })
        .limit(6),
      supabase.from("automation_runs")
        .select("id", { count: "exact", head: true })
        .in("automation_id", automationIds)
        .gte("created_at", zonedTimeToUtc(year, month, 1, 0, 0, SERVICE_TIMEZONE).toISOString())
        .lt("created_at", zonedTimeToUtc(year, month + 1, 1, 0, 0, SERVICE_TIMEZONE).toISOString()),
    ]);
    const runError = recentResult.error || countResult.error;
    if (runError) throw new Error("실행 기록을 불러오지 못했습니다.", { cause: runError });
    recentRuns = recentResult.data ?? [];
    monthlyRuns = countResult.count ?? 0;
  }

  const activeAutomations = automations.filter((automation) => automation.status === "ACTIVE");
  const nextAutomation = activeAutomations
    .filter((automation) => automation.next_run_at)
    .sort((a, b) => Date.parse(a.next_run_at!) - Date.parse(b.next_run_at!))[0];
  const subscription = subscriptionResult.data;
  const plan = subscription && (subscription.status === "ACTIVE" || subscription.status === "TRIALING")
    ? subscription.plan
    : "FREE";
  const planConfig = getPlanConfig(plan);
  const quotaRuns = usageResult.data?.automation_runs ?? 0;
  const hasBusiness = Boolean(businessResult.data);

  let calendarCount = 0;
  let diagnosisCount = 0;
  if (businessResult.data) {
    const [calendarResult, diagnosisResult] = await Promise.all([
      supabase.from("calendar_items").select("id", { count: "exact", head: true }).eq("business_id", businessResult.data.id),
      supabase.from("marketing_diagnoses").select("id", { count: "exact", head: true }).eq("business_id", businessResult.data.id),
    ]);
    calendarCount = calendarResult.count ?? 0;
    diagnosisCount = diagnosisResult.count ?? 0;
  }

  const displayName = profileResult.data?.display_name?.trim();
  const hasCreated = automations.length > 0 || recentRuns.some((run) => run.status === "SUCCESS");
  const steps = [
    { label: "가게 정보", href: hasBusiness ? "/business" : "/onboarding", done: hasBusiness },
    { label: "마케팅 진단", href: "/marketing/diagnosis", done: diagnosisCount > 0 },
    { label: "마케팅 캘린더", href: "/calendar", done: calendarCount > 0 },
    { label: "콘텐츠 만들기", href: "/calendar", done: hasCreated },
  ];
  const currentStep = steps.findIndex((step) => !step.done);
  const nextAction = [
    { title: "먼저 가게 정보를 알려주세요", description: "업체명만 적어도 시작할 수 있어요. 나머지는 나중에 채워도 괜찮아요.", cta: "가게 정보 입력하기", href: "/onboarding", pose: "welcome" as const },
    { title: "마케팅 진단부터 받아볼까요?", description: "지금 마케팅이 몇 점인지, 어느 채널이 비어 있는지 알려드려요.", cta: "무료 진단 받기", href: "/marketing/diagnosis", pose: "point" as const },
    { title: "이번 달 마케팅 계획을 세워볼까요?", description: "진단 결과에 맞춰 날짜별로 어떤 콘텐츠를 올릴지 정해드려요.", cta: "캘린더 만들기", href: "/calendar", pose: "guide" as const },
    { title: "첫 콘텐츠를 만들어볼까요?", description: "캘린더에 적어둔 주제 중 하나를 골라 블로그 글이나 숏폼을 만들어요. 만들고 나면 확인하고 고쳐서 직접 올리시면 돼요.", cta: "캘린더에서 만들기", href: "/calendar", pose: "guide" as const },
  ][currentStep] ?? { title: "잘 하고 계세요!", description: "다음 제작 일정과 이번 달 계획을 캘린더에서 확인해보세요.", cta: "캘린더 보기", href: "/calendar", pose: "thumbsUp" as const };

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title={displayName ? `${displayName}님, 안녕하세요` : "안녕하세요"}
        description="오늘 할 일과 이번 달 진행 상황을 한눈에 확인하세요."
      />

      <section aria-labelledby="next-action-title" className="relative overflow-hidden rounded-2xl bg-brand-soft">
        <div className="grid items-center gap-6 px-6 py-7 sm:px-9 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="max-w-xl">
            <p className="text-sm font-semibold text-primary">다음 할 일</p>
            <h2 id="next-action-title" className="mt-2 text-2xl font-extrabold tracking-[-0.04em] sm:text-[1.75rem]">{nextAction.title}</h2>
            <p className="mt-2 text-[15px] leading-7 text-muted-foreground">{nextAction.description}</p>
            <Button asChild size="lg" className="mt-6">
              <Link href={nextAction.href}>{nextAction.cta} <ArrowRight aria-hidden="true" /></Link>
            </Button>
          </div>
          <Mascot pose={nextAction.pose} size={190} className="mx-auto hidden w-[170px] md:block lg:w-[190px]" />
        </div>
        <ol className="grid border-t border-primary/10 bg-card/60 sm:grid-cols-4" aria-label="시작 단계">
          {steps.map((step, index) => (
            <li key={step.label} className="border-b border-primary/10 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
              <Link href={step.href} aria-current={index === currentStep ? "step" : undefined} className="flex min-h-14 items-center gap-3 px-5 py-3 text-sm font-semibold transition-colors hover:bg-card">
                <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.done ? "bg-success text-white" : index === currentStep ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                  {step.done ? <Check className="size-3.5" strokeWidth={3} aria-label="완료" /> : index + 1}
                </span>
                <span className={step.done ? "text-muted-foreground" : ""}>{step.label}</span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <StatGroup>
        <StatCard
          label="이번 달 만든 콘텐츠"
          value={<>{monthlyRuns.toLocaleString()}<span className="ml-1 text-sm font-semibold text-muted-foreground">개</span></>}
          hint={<Link href="/growth-report" className="font-medium text-primary hover:underline">성장 리포트 보기</Link>}
        />
        <StatCard
          label="진행 중인 만들기 설정"
          value={<>{activeAutomations.length}<span className="ml-1 text-sm font-semibold text-muted-foreground">개</span></>}
          hint={<Link href="/automations" className="font-medium text-primary hover:underline">전체 {automations.length}개 보기</Link>}
        />
        <StatCard
          label="다음 제작 예정"
          value={nextAutomation?.next_run_at ? <span className="block text-lg leading-8">{dateFormatter.format(new Date(nextAutomation.next_run_at))}</span> : "예정 없음"}
          hint={nextAutomation ? <Link href={`/automations/${nextAutomation.id}`} className="font-medium text-primary hover:underline">{nextAutomation.name}</Link> : "만들기를 켜면 일정이 표시돼요"}
        />
        <StatCard
          label="이용 중인 플랜"
          value={PLAN_LABEL[plan]}
          hint={<Link href="/billing" className="font-medium text-primary hover:underline">플랜 관리</Link>}
        />
      </StatGroup>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,1fr)]">
        <section aria-labelledby="recent-title">
          <div className="flex items-end justify-between gap-3 border-b border-border pb-3">
            <h2 id="recent-title" className="text-lg font-bold tracking-[-0.02em]">최근 제작 기록</h2>
            <Link href="/automations/history" className="text-sm font-semibold text-primary hover:underline">전체 보기</Link>
          </div>
          {recentRuns.length === 0 ? (
            <EmptyState
              className="mt-5"
              mascot={null}
              title="아직 제작 기록이 없어요"
              description="블로그 글이나 숏폼 영상을 만들면 여기에서 바로 확인할 수 있어요."
              action={<Button asChild size="sm"><Link href="/calendar">캘린더에서 만들기</Link></Button>}
            />
          ) : (
            <ul className="divide-y divide-border">
              {recentRuns.map((run) => {
                const StatusIcon = run.status === "SUCCESS" ? CircleCheck : run.status === "FAILED" ? CircleX : PlayCircle;
                return (
                  <li key={run.id} className="flex flex-wrap items-center gap-3 py-4 sm:flex-nowrap">
                    <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${run.status === "SUCCESS" ? "bg-success-soft text-success" : run.status === "FAILED" ? "bg-destructive/10 text-destructive" : "bg-brand-soft text-primary"}`}>
                      <StatusIcon className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/automations/${run.automation_id}/runs/${run.id}`} className="block truncate font-semibold hover:text-primary hover:underline">
                        {automationNames.get(run.automation_id) ?? "콘텐츠 만들기"}
                      </Link>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">{dateFormatter.format(new Date(run.created_at))}</p>
                      {run.status === "FAILED" && run.error_message ? <p className="mt-1 line-clamp-1 text-[13px] text-destructive">{run.error_message}</p> : null}
                    </div>
                    <Badge variant={run.status === "FAILED" ? "destructive" : run.status === "SUCCESS" ? "success" : "brand"}>{RUN_STATUS_LABEL[run.status]}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="space-y-8" aria-label="사용량과 도움">
          <section aria-labelledby="usage-title" className="rounded-xl border border-border bg-card p-5">
            <h2 id="usage-title" className="text-base font-bold tracking-[-0.02em]">이번 달 사용량</h2>
            <p className="tabular mt-3 text-2xl font-extrabold tracking-[-0.03em]">
              {quotaRuns.toLocaleString()}
              <span className="ml-1 text-sm font-semibold text-muted-foreground">/ {planConfig.monthlyRunLimit?.toLocaleString() ?? "무제한"}회</span>
            </p>
            {planConfig.monthlyRunLimit !== null ? <Progress value={Math.min(100, (quotaRuns / planConfig.monthlyRunLimit) * 100)} className="mt-3" aria-label="이번 달 제작 사용량" /> : null}
            <p className="mt-3 text-[13px] leading-5 text-muted-foreground">플랜의 월 제작 한도에 반영되는 횟수예요.</p>
          </section>

          <section aria-labelledby="setup-title">
            <div className="flex items-end justify-between gap-3 border-b border-border pb-3">
              <h2 id="setup-title" className="flex items-center gap-2 text-base font-bold tracking-[-0.02em]"><Wrench className="size-4 text-primary" aria-hidden="true" /> 대신 설정해드려요</h2>
              <Link href="/setup-request" className="text-sm font-semibold text-primary hover:underline">새 요청</Link>
            </div>
            {setupRequests.length === 0 ? (
              <p className="mt-4 text-[15px] leading-7 text-muted-foreground">직접 설정하기 어려우면 전문가에게 맡길 수 있어요.</p>
            ) : (
              <ul className="divide-y divide-border">
                {setupRequests.map((request) => (
                  <li key={request.id} className="flex items-center justify-between gap-3 py-3.5">
                    <div className="min-w-0">
                      <Link href={`/setup-request/${request.id}`} className="block truncate font-semibold hover:text-primary hover:underline">{setupAutomationTypeLabel(request.automation_type)}</Link>
                      <p className="mt-0.5 text-[13px] text-muted-foreground">{setupRequestNumber(request.id)} · {SETUP_REQUEST_STATUS[request.status].description}</p>
                    </div>
                    <SetupRequestStatusBadge status={request.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
