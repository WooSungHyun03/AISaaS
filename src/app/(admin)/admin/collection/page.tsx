import { Database } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { CollectNowForm } from "@/components/admin/collect-now-form";
import { requireAdmin } from "@/server/admin/access";
import { listRecentCollectionRuns } from "@/server/channels";
import { collectNowAction } from "./actions";

const format = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
const TRIGGER_LABEL: Record<string, string> = { CRON: "자동(매일 06:00 KST)", MANUAL_ADMIN: "관리자 수동", MANUAL_USER: "사용자 수동", REGISTER: "채널 등록" };
const STATUS_VARIANT = { SUCCESS: "secondary", PARTIAL: "outline", FAILED: "destructive", RUNNING: "outline" } as const;

export default async function AdminCollectionPage() {
  await requireAdmin({ action: "ADMIN_COLLECTION_VIEW", targetType: "route", targetId: "/admin/collection", onDenied: "navigate" });
  const runs = await listRecentCollectionRuns(40);
  return (
    <div className="space-y-6">
      <PageHeader title="채널 수집 기록" description="매일 06:00(KST)에 YouTube·블로그의 공개 지표를 자동 수집한 결과예요. 실패와 YouTube 할당량 소진도 여기서 확인해요." />
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="font-bold">지금 수집</h2>
        <p className="mb-3 mt-1 text-sm text-muted-foreground">운영 확인용이에요. 10분에 한 번만 실행할 수 있고, 모든 활성 채널을 한 번 더 수집해요.</p>
        <CollectNowForm action={collectNowAction} />
      </section>
      <section className="overflow-hidden rounded-2xl border bg-card">
        {runs.length ? (
          <ul className="divide-y">
            {runs.map((run) => (
              <li key={run.id} className="space-y-1 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{format.format(new Date(run.started_at))} · {TRIGGER_LABEL[run.trigger] ?? run.trigger}</p>
                  <Badge variant={STATUS_VARIANT[run.status as keyof typeof STATUS_VARIANT] ?? "outline"}>{run.status}</Badge>
                </div>
                <p className="text-muted-foreground">
                  대상 {run.channels_total} · 성공 {run.channels_succeeded} · 실패 {run.channels_failed} · 건너뜀 {run.channels_skipped}
                  {run.quota_exceeded ? " · YouTube 할당량 소진" : ""}
                </p>
                {run.error_summary && <p className="rounded-lg bg-destructive/10 p-2 text-destructive">{run.error_summary}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-10 text-center text-sm text-muted-foreground"><Database className="mx-auto mb-3 size-7" aria-hidden="true" />아직 수집 기록이 없어요. 채널이 등록되면 다음 06:00(KST)에 첫 기록이 생겨요.</div>
        )}
      </section>
    </div>
  );
}
