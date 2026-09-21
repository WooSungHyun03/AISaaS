import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarClock, CircleCheck, CircleX, Clock3, PlayCircle, Store, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPlanConfig } from "@/server/billing/plans";
import { getPeriodKey, SERVICE_TIMEZONE, zonedTimeToUtc } from "@/lib/utils/date";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import type { AutomationRun } from "@/types/domain";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

const RUN_STATUS_LABEL = {
  QUEUED: "대기 중",
  RUNNING: "실행 중",
  SUCCESS: "성공",
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

  const [businessResult, automationResult, subscriptionResult, usageResult] = await Promise.all([
    supabase.from("businesses").select("id").eq("owner_id", user.id).limit(1).maybeSingle(),
    supabase.from("automations").select("id, name, status, next_run_at").eq("user_id", user.id),
    supabase.from("subscriptions").select("plan, status").eq("user_id", user.id).maybeSingle(),
    supabase.from("usage").select("automation_runs").eq("user_id", user.id).eq("period", periodKey).maybeSingle(),
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

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-700">Overview</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">자동화 운영 현황과 최근 실행 결과를 확인하세요.</p>
        </div>
        <Button asChild className="h-9 bg-blue-600 text-white hover:bg-blue-700">
          <Link href="/automations/marketplace"><Store className="size-4" /> 자동화 둘러보기</Link>
        </Button>
      </div>

      {!hasBusiness ? (
        <Card className="border border-blue-200 bg-blue-50/60 ring-0">
          <CardContent className="flex flex-col gap-4 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-slate-950">사업체 정보를 입력하고 자동화를 시작하세요</p>
              <p className="mt-1 text-sm text-slate-600">업체명만 먼저 입력해도 됩니다. 나머지는 나중에 추가할 수 있어요.</p>
            </div>
            <Button asChild variant="outline" className="shrink-0 bg-white">
              <Link href="/onboarding">사업체 정보 입력 <ArrowRight className="size-4" /></Link>
            </Button>
          </CardContent>
        </Card>
      ) : automations.length === 0 ? (
        <Card className="border border-blue-200 bg-blue-50/60 ring-0">
          <CardContent className="flex flex-col gap-4 py-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-slate-950">아직 생성한 자동화가 없습니다</p>
              <p className="mt-1 text-sm text-slate-600">마켓플레이스에서 첫 자동화를 선택해보세요.</p>
            </div>
            <Button asChild variant="outline" className="shrink-0 bg-white">
              <Link href="/automations/marketplace">자동화 선택 <ArrowRight className="size-4" /></Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active Automations" value={activeAutomations.length} hint={<Link href="/automations" className="hover:underline">전체 {automations.length}개 자동화 보기 →</Link>} />
        <StatCard label="Monthly Runs" value={monthlyRuns} hint="이번 달 전체 실행 기록 · KST 기준" />
        <StatCard label="Current Plan" value={planConfig.name} hint={<Link href="/billing" className="hover:underline">플랜 관리 →</Link>} />
        <StatCard
          label="Next Scheduled Run"
          value={nextAutomation?.next_run_at ? <span className="block text-base leading-7">{dateFormatter.format(new Date(nextAutomation.next_run_at))}</span> : "예정 없음"}
          hint={nextAutomation ? <Link href={`/automations/${nextAutomation.id}`} className="hover:underline">{nextAutomation.name} →</Link> : "활성 자동화의 다음 실행 시각"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,1fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">최근 실행 6건</p>
            </div>
            <Link href="/automations" className="text-xs font-medium text-blue-700 hover:underline">자동화 관리 →</Link>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <Clock3 className="size-7 text-slate-300" />
                <p className="text-sm font-medium">아직 실행 기록이 없습니다</p>
                <p className="text-xs text-muted-foreground">자동화를 실행하면 이곳에 결과가 표시됩니다.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recentRuns.map((run) => {
                  const StatusIcon = run.status === "SUCCESS" ? CircleCheck : run.status === "FAILED" ? CircleX : PlayCircle;
                  return (
                    <li key={run.id} className="flex flex-wrap items-center gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-nowrap">
                      <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${run.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700" : run.status === "FAILED" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
                        <StatusIcon className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link href={`/automations/${run.automation_id}`} className="block truncate text-sm font-medium hover:text-blue-700 hover:underline">
                          {automationNames.get(run.automation_id) ?? "자동화"}
                        </Link>
                        <p className="mt-0.5 text-xs text-muted-foreground">{dateFormatter.format(new Date(run.created_at))}</p>
                        {run.status === "FAILED" && run.error_message ? <p className="mt-1 line-clamp-1 text-xs text-red-700">{run.error_message}</p> : null}
                      </div>
                      <div className="ml-12 flex items-center gap-3 sm:ml-0">
                        <Badge variant={run.status === "FAILED" ? "destructive" : run.status === "SUCCESS" ? "secondary" : "outline"}>{RUN_STATUS_LABEL[run.status]}</Badge>
                        {run.status === "FAILED" ? (
                          <Link href={`/automations/${run.automation_id}/runs/${run.id}`} className="whitespace-nowrap text-xs font-semibold text-red-700 underline-offset-2 hover:underline">오류 상세</Link>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Zap className="size-4 text-blue-700" /> 이번 달 사용량</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">성공 실행</span>
                <span className="font-semibold">{quotaRuns.toLocaleString()} / {planConfig.monthlyRunLimit?.toLocaleString() ?? "무제한"}</span>
              </div>
              {planConfig.monthlyRunLimit !== null ? <Progress value={Math.min(100, (quotaRuns / planConfig.monthlyRunLimit) * 100)} aria-label="이번 달 실행 사용량" /> : null}
              <p className="text-xs text-muted-foreground">플랜의 월간 실행 한도에 반영되는 수치입니다.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="size-4 text-blue-700" /> 다음 일정</CardTitle>
            </CardHeader>
            <CardContent>
              {nextAutomation?.next_run_at ? (
                <>
                  <p className="text-sm font-medium">{nextAutomation.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{dateFormatter.format(new Date(nextAutomation.next_run_at))} KST</p>
                  <Link href={`/automations/${nextAutomation.id}`} className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">설정 보기 <ArrowRight className="size-3" /></Link>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">예약된 실행이 없습니다. 자동화를 활성화하면 다음 일정이 표시됩니다.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
