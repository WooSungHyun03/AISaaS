import { notFound, redirect } from "next/navigation";
import { ExternalLink, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAutomationRunDetail } from "@/server/automations/history";
import { describeAutomationRunError } from "@/server/shared/errors";
import { RunSourceBadge, RunStatusBadge } from "@/components/automations/run-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/layout/page-header";
import { Mascot } from "@/components/brand/mascot";

const formatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

function formatDate(value: string | null, fallback = "-") {
  return value ? formatter.format(new Date(value)) : fallback;
}

function durationLabel(startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) return "-";
  const seconds = Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}분 ${seconds % 60}초`;
}

export default async function RunDetailPage({ params }: PageProps<"/automations/[id]/runs/[runId]">) {
  const { id, runId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const detail = await getAutomationRunDetail(user.id, id, runId);
  if (!detail) notFound();
  const { automation, run } = detail;
  const output = run.output;
  const field = "bg-card px-5 py-4";
  const label = "text-[13px] font-semibold text-muted-foreground";

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        back={{ href: `/automations/${automation.id}`, label: automation.name }}
        title="만든 결과"
        description={<span className="flex flex-wrap items-center gap-2"><RunStatusBadge status={run.status} /><RunSourceBadge source={run.source} /><span>{formatDate(run.createdAt)}</span></span>}
      />

      {run.status === "FAILED" ? (
        <FormMessage>
          <strong className="block">만들지 못했어요</strong>
          {describeAutomationRunError(run.errorMessage)}
          <span className="mt-1 block text-[13px] opacity-90">연결 정보와 설정을 확인하고 다시 만들어보세요. 계속되면 아래 번호와 함께 문의해주세요.</span>
        </FormMessage>
      ) : null}

      {run.status === "RUNNING" || run.status === "QUEUED" ? (
        <div role="status" className="flex items-center gap-4 rounded-2xl bg-brand-soft px-6 py-5">
          <Mascot pose="cheer" size={72} className="mascot-bob shrink-0" />
          <div>
            <p className="flex items-center gap-2 font-bold"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{run.status === "RUNNING" ? "콘텐츠를 만드는 중이에요" : "순서를 기다리고 있어요"}</p>
            <p className="mt-1 text-sm text-muted-foreground">끝나면 새로고침해서 결과를 확인하세요.</p>
          </div>
        </div>
      ) : null}

      {run.status === "SUCCESS" ? (
        <section aria-labelledby="result-heading" className="space-y-5">
          <h2 id="result-heading" className="text-lg font-extrabold tracking-[-0.03em]">결과</h2>
          {!output ? <p className="rounded-2xl bg-muted px-5 py-6 text-[15px] text-muted-foreground">이번에는 보여줄 결과가 없어요.</p> : (
            <div className="space-y-6 rounded-2xl border bg-card px-5 py-6 sm:px-8">
              {output.title ? <div><p className={label}>제목</p><p className="mt-1 text-xl font-extrabold leading-8 tracking-[-0.03em]">{output.title}</p></div> : null}
              {output.topic ? <div><p className={label}>주제</p><p className="mt-1 text-[15px] leading-7">{output.topic}</p></div> : null}
              {output.summary ? <div><p className={label}>요약</p><p className="mt-1 whitespace-pre-wrap text-[15px] leading-7">{output.summary}</p></div> : null}
              {output.body ? (
                <div>
                  <p className={label}>본문</p>
                  <div className="mt-2 max-h-[520px] overflow-y-auto rounded-xl bg-muted px-5 py-4 text-[15px] leading-8 whitespace-pre-wrap">{output.body}</div>
                </div>
              ) : null}
              {output.callToAction ? <div><p className={label}>행동 유도 문구</p><p className="mt-1 text-[15px] leading-7">{output.callToAction}</p></div> : null}
              {output.keywords.length ? <div><p className={label}>키워드</p><div className="mt-2 flex flex-wrap gap-1.5">{output.keywords.map((keyword) => <Badge key={keyword} variant="brand">{keyword}</Badge>)}</div></div> : null}
            </div>
          )}
          {output?.externalUrl ? (
            <div className="flex flex-col gap-3 rounded-2xl bg-brand-soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><p className="font-bold">WordPress {output.destinationStatus === "draft" ? "초안으로 저장했어요" : "에 올라갔어요"}</p><p className="mt-0.5 break-all text-sm text-muted-foreground">{output.externalUrl}</p></div>
              <Button asChild variant="outline" className="shrink-0"><a href={output.externalUrl} target="_blank" rel="noopener noreferrer">열기 <ExternalLink aria-hidden="true" /></a></Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">이지 마케팅에 저장돼 있어요. 본문을 복사해서 직접 올려주세요.</p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="info-heading" className="space-y-3">
        <h2 id="info-heading" className="text-lg font-extrabold tracking-[-0.03em]">진행 정보</h2>
        <dl className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3">
          <div className={field}><dt className={label}>시작</dt><dd className="tabular mt-1 font-medium">{formatDate(run.startedAt, "대기 중")}</dd></div>
          <div className={field}><dt className={label}>완료</dt><dd className="tabular mt-1 font-medium">{formatDate(run.completedAt, run.status === "RUNNING" ? "만드는 중" : "-")}</dd></div>
          <div className={field}><dt className={label}>걸린 시간</dt><dd className="mt-1 font-medium">{durationLabel(run.startedAt, run.completedAt)}</dd></div>
          <div className={`${field} sm:col-span-3`}><dt className={label}>문의용 번호</dt><dd className="mt-1 break-all font-mono text-xs text-muted-foreground">{run.id}</dd></div>
        </dl>
      </section>
    </div>
  );
}
