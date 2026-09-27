import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Bot, CheckCircle2, CircleX, Clock3, ExternalLink, FileText, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAutomationRunDetail } from "@/server/automations/history";
import { describeAutomationRunError } from "@/server/shared/errors";
import { RunSourceBadge, RunStatusBadge } from "@/components/automations/run-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const formatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Seoul",
});

function formatDate(value: string | null, fallback = "기록 없음") {
  return value ? `${formatter.format(new Date(value))} KST` : fallback;
}

function durationLabel(startedAt: string | null, completedAt: string | null) {
  if (!startedAt || !completedAt) return "계산 중";
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
  const StatusIcon = run.status === "SUCCESS" ? CheckCircle2 : run.status === "FAILED" ? CircleX : run.status === "RUNNING" ? LoaderCircle : Clock3;
  const statusColor = run.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700" : run.status === "FAILED" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" className="-ml-2"><Link href="/automations/history"><ArrowLeft /> 실행 이력</Link></Button>
        <span className="text-muted-foreground">/</span>
        <Link href={`/automations/${automation.id}`} className="text-sm font-medium text-muted-foreground hover:text-foreground hover:underline">{automation.name}</Link>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${statusColor}`}>
            <StatusIcon className={`size-6 ${run.status === "RUNNING" ? "animate-spin" : ""}`} />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Automation run</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">실행 상세</h1>
            <p className="mt-1 text-sm text-muted-foreground">{automation.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2"><RunSourceBadge source={run.source} /><RunStatusBadge status={run.status} /></div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">실행 정보</CardTitle></CardHeader>
        <CardContent className="grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-muted-foreground">요청 시각</p><p className="mt-1 font-medium">{formatDate(run.createdAt)}</p></div>
          <div><p className="text-muted-foreground">시작 시각</p><p className="mt-1 font-medium">{formatDate(run.startedAt, "대기 중")}</p></div>
          <div><p className="text-muted-foreground">완료 시각</p><p className="mt-1 font-medium">{formatDate(run.completedAt, run.status === "RUNNING" ? "진행 중" : "기록 없음")}</p></div>
          <div><p className="text-muted-foreground">실행 시간</p><p className="mt-1 font-medium">{durationLabel(run.startedAt, run.completedAt)}</p></div>
          <div className="sm:col-span-2 lg:col-span-4"><p className="text-muted-foreground">실행 ID</p><p className="mt-1 break-all font-mono text-xs">{run.id}</p></div>
        </CardContent>
      </Card>

      {run.status === "FAILED" ? (
        <Card className="border border-red-200 bg-red-50/40 ring-0">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base text-red-900"><CircleX className="size-4" /> 오류 메시지</CardTitle></CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-red-900">{describeAutomationRunError(run.errorMessage)}</p>
            <p className="mt-3 text-xs text-red-800">연결 정보와 자동화 설정을 확인한 뒤 다시 실행해주세요. 문제가 반복되면 실행 ID와 함께 문의해주세요.</p>
          </CardContent>
        </Card>
      ) : null}

      {run.status === "RUNNING" || run.status === "QUEUED" ? (
        <Card className="border border-blue-200 bg-blue-50/40 ring-0">
          <CardContent className="flex items-center gap-3 py-5 text-blue-900">
            <LoaderCircle className={`size-5 ${run.status === "RUNNING" ? "animate-spin" : ""}`} />
            <div><p className="font-medium">{run.status === "RUNNING" ? "자동화를 실행하고 있습니다" : "실행 순서를 기다리고 있습니다"}</p><p className="mt-1 text-xs text-blue-800">완료 후 새로고침하면 AI 결과와 게시 URL을 확인할 수 있습니다.</p></div>
          </CardContent>
        </Card>
      ) : null}

      {run.status === "SUCCESS" ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Bot className="size-4 text-blue-700" /> AI 실행 결과</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            {!output ? <p className="text-sm text-muted-foreground">이 실행에서 표시할 수 있는 AI 결과가 없습니다.</p> : (
              <>
                {output.title ? <div><p className="text-xs font-medium text-muted-foreground">생성 제목</p><p className="mt-1 text-lg font-semibold">{output.title}</p></div> : null}
                {output.topic ? <div><p className="text-xs font-medium text-muted-foreground">선택 주제</p><p className="mt-1 text-sm leading-6">{output.topic}</p></div> : null}
                {output.summary ? <div><p className="text-xs font-medium text-muted-foreground">요약</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{output.summary}</p></div> : null}
                {output.body ? (
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><FileText className="size-3.5" /> 생성 본문</p>
                    <div className="mt-2 max-h-[480px] overflow-y-auto rounded-xl border bg-muted/20 p-4 text-sm leading-7 whitespace-pre-wrap">{output.body}</div>
                  </div>
                ) : null}
                {output.callToAction ? <div><p className="text-xs font-medium text-muted-foreground">행동 유도 문구</p><p className="mt-1 text-sm leading-6">{output.callToAction}</p></div> : null}
                {output.keywords.length ? <div><p className="text-xs font-medium text-muted-foreground">키워드</p><div className="mt-2 flex flex-wrap gap-1.5">{output.keywords.map((keyword) => <Badge key={keyword} variant="secondary">{keyword}</Badge>)}</div></div> : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {run.status === "SUCCESS" ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ExternalLink className="size-4 text-blue-700" /> 외부 게시 결과</CardTitle></CardHeader>
          <CardContent>
            {output?.externalUrl ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="font-medium">WordPress {output.destinationStatus === "draft" ? "초안이 저장되었습니다" : "게시가 완료되었습니다"}</p><p className="mt-1 break-all text-sm text-muted-foreground">{output.externalUrl}</p></div>
                <Button asChild variant="outline"><a href={output.externalUrl} target="_blank" rel="noopener noreferrer">게시물 열기 <ExternalLink /></a></Button>
              </div>
            ) : <p className="text-sm text-muted-foreground">외부 게시 URL이 없습니다. 생성 결과는 앱에 저장되었습니다.</p>}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
