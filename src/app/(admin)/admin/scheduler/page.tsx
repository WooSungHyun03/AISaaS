import { Clock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/server/admin/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSchedulerHealth, listRecentTicks } from "@/server/automations/ticks";
import { getVideoPipelineChecks } from "@/server/connectors/video-readiness";

export const dynamic = "force-dynamic";

const format = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" });
const TRIGGER_LABEL: Record<string, string> = { CRON: "DB 스케줄러(5분)", VERCEL_CRON: "Vercel 하루 1회", MANUAL: "수동" };

export default async function AdminSchedulerPage() {
  await requireAdmin({ action: "ADMIN_SCHEDULER_VIEW", targetType: "route", targetId: "/admin/scheduler", onDenied: "navigate" });
  const admin = createAdminClient();
  const videoChecks = getVideoPipelineChecks();
  const [health, ticks, active, parked] = await Promise.all([
    getSchedulerHealth(),
    listRecentTicks(40),
    admin.from("automations").select("id, name, next_run_at, consecutive_failures, last_run_at").eq("status", "ACTIVE").order("next_run_at", { ascending: true }).limit(100),
    admin.from("automations").select("id, name, consecutive_failures, last_run_at, updated_at").eq("status", "ERROR").order("updated_at", { ascending: false }).limit(50),
  ]);
  // "Overdue" is judged against the time the scheduler last ran, not the render clock: if it ran a minute ago and an
  // automation is still more than 15 minutes late, that automation (not the scheduler) is the problem.
  const reference = health.lastTickAt ? Date.parse(health.lastTickAt) : null;
  const overdue = reference === null ? [] : (active.data ?? []).filter((row) => row.next_run_at && Date.parse(row.next_run_at) < reference - 15 * 60_000);

  return (
    <div className="space-y-6">
      <PageHeader title="예약 실행 상태" description="예약 제작을 깨우는 스케줄러(pg_cron → Edge Function → /api/cron/run-automations)가 돌고 있는지, 무엇을 했는지 보여줘요." />

      <section className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-bold"><Clock className="size-4" aria-hidden="true" />마지막 실행</h2>
            <p className="mt-1 text-sm text-muted-foreground">{health.lastTickAt ? `${format.format(new Date(health.lastTickAt))} (${health.ageMinutes}분 전)` : "아직 실행 기록이 없어요."}</p>
          </div>
          <Badge variant={health.healthy ? "secondary" : "destructive"}>{health.healthy ? "정상" : "멈춘 것 같아요"}</Badge>
        </div>
        {!health.healthy ? <p className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">15분 넘게 실행 기록이 없어요. Supabase에서 `select * from cron.job_run_details order by start_time desc limit 5;` 로 pg_cron 상태를, Edge Function 로그와 `CRON_SECRET` 일치 여부를 확인하세요.</p> : null}
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card">
        <h2 className="border-b px-5 py-3 font-bold">광고 영상 서비스 연결 {videoChecks.some((check) => check.required && !check.ok) ? <span className="text-destructive">· 빠진 설정이 있어 영상을 만들 수 없어요</span> : <span className="text-success">· 모두 연결됨</span>}</h2>
        <ul className="divide-y text-sm">
          {videoChecks.map((check) => (
            <li key={check.name} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <span><span className="font-semibold">{check.label}</span> <code className="text-xs text-muted-foreground">{check.name}</code></span>
              {check.ok ? <Badge variant="secondary">설정됨</Badge> : <span className={check.required ? "text-destructive" : "text-muted-foreground"}>{check.required ? "빠짐" : "안 씀"} · {check.hint}</span>}
            </li>
          ))}
        </ul>
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">값은 보여주지 않고 이름과 설정 여부만 보여줘요. 환경변수를 바꾸면 다시 배포해야 적용돼요.</p>
      </section>

      {parked.data?.length ? (
        <section className="overflow-hidden rounded-2xl border bg-card">
          <h2 className="border-b px-5 py-3 font-bold">여러 번 실패해서 멈춘 예약 ({parked.data.length})</h2>
          <ul className="divide-y text-sm">
            {parked.data.map((row) => <li key={row.id} className="flex flex-wrap justify-between gap-2 px-5 py-3"><span className="font-semibold">{row.name}</span><span className="text-muted-foreground">연속 실패 {row.consecutive_failures}회 · 마지막 성공 {row.last_run_at ? format.format(new Date(row.last_run_at)) : "없음"}</span></li>)}
          </ul>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border bg-card">
        <h2 className="border-b px-5 py-3 font-bold">켜져 있는 예약 {active.data?.length ?? 0}개 {overdue.length > 0 ? <span className="text-destructive">· 시간이 지났는데 아직 안 돈 것 {overdue.length}개</span> : null}</h2>
        {active.data?.length ? (
          <ul className="divide-y text-sm">
            {active.data.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 px-5 py-3">
                <span className="font-semibold">{row.name}</span>
                <span className="text-muted-foreground">다음 {row.next_run_at ? format.format(new Date(row.next_run_at)) : "-"}{row.consecutive_failures > 0 ? ` · 연속 실패 ${row.consecutive_failures}회` : ""}</span>
              </li>
            ))}
          </ul>
        ) : <p className="p-5 text-sm text-muted-foreground">켜져 있는 예약이 없어요.</p>}
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card">
        <h2 className="border-b px-5 py-3 font-bold">최근 실행 기록</h2>
        {ticks.length ? (
          <ul className="divide-y text-sm">
            {ticks.map((tick) => (
              <li key={tick.id} className="space-y-0.5 px-5 py-3">
                <p className="font-semibold">{format.format(new Date(tick.started_at))} · {TRIGGER_LABEL[tick.trigger] ?? tick.trigger}</p>
                <p className="text-muted-foreground">대상 {tick.due_found} · 시작 {tick.started} · 성공 {tick.succeeded} · 실패 {tick.failed} · 건너뜀 {tick.skipped} · 이어서 진행 {tick.advanced} · 정리 {tick.reaped} · 채널 수집 {tick.channels_processed}</p>
                {tick.error ? <p className="text-destructive">{tick.error}</p> : null}
              </li>
            ))}
          </ul>
        ) : <p className="p-5 text-sm text-muted-foreground">아직 실행 기록이 없어요.</p>}
      </section>
    </div>
  );
}
