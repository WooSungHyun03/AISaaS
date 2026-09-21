import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPlanConfig } from "@/server/billing/plans";
import { getPeriodKey } from "@/lib/utils/date";
import { StatCard } from "@/components/dashboard/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

const RUN_STATUS_LABEL: Record<string, string> = {
  QUEUED: "대기중",
  RUNNING: "실행중",
  SUCCESS: "성공",
  FAILED: "실패",
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: businesses }, { data: automations }, { data: subscription }, { data: usage }] = await Promise.all([
    supabase.from("businesses").select("id").eq("owner_id", user.id),
    supabase.from("automations").select("*").eq("user_id", user.id),
    supabase.from("subscriptions").select("plan").eq("user_id", user.id).maybeSingle(),
    supabase.from("usage").select("*").eq("user_id", user.id).eq("period", getPeriodKey()).maybeSingle(),
  ]);

  const hasBusiness = (businesses ?? []).length > 0;
  const activeAutomations = (automations ?? []).filter((a) => a.status === "ACTIVE");
  const plan = subscription?.plan ?? "FREE";
  const planConfig = getPlanConfig(plan);
  const monthlyRuns = usage?.automation_runs ?? 0;
  const nextRun = activeAutomations
    .map((a) => a.next_run_at)
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  const automationIds = new Map((automations ?? []).map((a) => [a.id, a.name]));
  const { data: recentRuns } = automationIds.size
    ? await supabase
        .from("automation_runs")
        .select("*")
        .in("automation_id", Array.from(automationIds.keys()))
        .order("created_at", { ascending: false })
        .limit(5)
    : { data: [] };

  if (!hasBusiness) {
    return (
      <div className="mx-auto max-w-xl space-y-4 text-center">
        <h1 className="text-2xl font-bold tracking-tight">환영합니다!</h1>
        <p className="text-muted-foreground">자동화를 시작하려면 먼저 사업체 프로필을 등록해주세요.</p>
        <Button asChild>
          <Link href="/onboarding">사업체 정보 입력하기</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active Automations" value={activeAutomations.length} />
        <StatCard label="Monthly Automation Runs" value={monthlyRuns} />
        <StatCard
          label="Next Scheduled Run"
          value={nextRun ? new Date(nextRun).toLocaleString("ko-KR") : "예정 없음"}
        />
        <StatCard label="Current Plan" value={planConfig.name} hint={<Link href="/billing">플랜 관리 →</Link>} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">이번 달 사용량</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>자동화 실행</span>
            <span>
              {monthlyRuns} / {planConfig.monthlyRunLimit ?? "무제한"}
            </span>
          </div>
          {planConfig.monthlyRunLimit ? (
            <Progress value={Math.min(100, (monthlyRuns / planConfig.monthlyRunLimit) * 100)} />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentRuns && recentRuns.length > 0 ? (
            <ul className="divide-y">
              {recentRuns.map((run) => (
                <li key={run.id} className="flex items-center justify-between py-3 text-sm">
                  <span>{automationIds.get(run.automation_id) ?? "자동화"}</span>
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <span>{new Date(run.created_at).toLocaleString("ko-KR")}</span>
                    <Badge variant={run.status === "SUCCESS" ? "default" : run.status === "FAILED" ? "destructive" : "secondary"}>
                      {RUN_STATUS_LABEL[run.status] ?? run.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">아직 실행 기록이 없습니다.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
