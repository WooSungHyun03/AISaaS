import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CircleX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { describeAutomationRunError } from "@/server/shared/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const formatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Seoul",
});

export default async function RunDetailPage({ params }: PageProps<"/automations/[id]/runs/[runId]">) {
  const { id, runId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: automation, error: automationError } = await supabase
    .from("automations")
    .select("id, name")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (automationError) throw new Error("자동화 정보를 불러오지 못했습니다.", { cause: automationError });
  if (!automation) notFound();

  const { data: run, error: runError } = await supabase
    .from("automation_runs")
    .select("id, automation_id, status, error_message, created_at, started_at, completed_at")
    .eq("id", runId)
    .eq("automation_id", automation.id)
    .maybeSingle();
  if (runError) throw new Error("실행 기록을 불러오지 못했습니다.", { cause: runError });
  if (!run) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" className="-ml-2"><Link href={`/automations/${automation.id}`}><ArrowLeft className="size-4" /> 자동화로 돌아가기</Link></Button>
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700"><CircleX className="size-5" /></span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Automation run</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">실행 상세</h1>
          <p className="mt-1 text-sm text-muted-foreground">{automation.name}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">실행 결과</CardTitle>
          <Badge variant={run.status === "FAILED" ? "destructive" : run.status === "SUCCESS" ? "default" : "secondary"}>
            {run.status === "FAILED" ? "실패" : run.status === "SUCCESS" ? "성공" : run.status === "RUNNING" ? "실행 중" : "대기 중"}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <div><p className="text-muted-foreground">생성 시각</p><p className="mt-1 font-medium">{formatter.format(new Date(run.created_at))} KST</p></div>
          <div><p className="text-muted-foreground">시작 시각</p><p className="mt-1 font-medium">{run.started_at ? `${formatter.format(new Date(run.started_at))} KST` : "기록 없음"}</p></div>
          <div><p className="text-muted-foreground">완료 시각</p><p className="mt-1 font-medium">{run.completed_at ? `${formatter.format(new Date(run.completed_at))} KST` : "기록 없음"}</p></div>
          <div><p className="text-muted-foreground">실행 ID</p><p className="mt-1 break-all font-mono text-xs">{run.id}</p></div>
        </CardContent>
      </Card>

      {run.status === "FAILED" ? (
        <Card className="border border-red-200 bg-red-50/40 ring-0">
          <CardHeader><CardTitle className="text-base text-red-900">오류 내용</CardTitle></CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-red-900">{describeAutomationRunError(run.error_message)}</p>
            <p className="mt-3 text-xs text-red-800">문제가 반복되면 실행 ID와 함께 관리자에게 문의해주세요.</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
