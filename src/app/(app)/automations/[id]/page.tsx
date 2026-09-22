import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RunNowButton } from "@/components/automations/run-now-button";
import { AutomationStatusActions } from "@/components/automations/automation-status-actions";
import type { AutomationSchedule } from "@/types/automation";
import { BLOG_DELIVERY_LABEL, blogSetupSchema, type BlogAutomationConfig } from "@/types/blog-automation";
import type { Json } from "@/types/domain";

const STATUS_LABEL: Record<string, string> = { DRAFT: "초안", ACTIVE: "실행중", PAUSED: "일시정지", ERROR: "오류" };
const RUN_STATUS_LABEL: Record<string, string> = {
  QUEUED: "대기중",
  RUNNING: "실행중",
  SUCCESS: "성공",
  FAILED: "실패",
};
const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

function resultOutput(value: Json | null): Record<string, Json | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export default async function AutomationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: automation } = await supabase.from("automations").select("*").eq("id", id).single();
  if (!automation) notFound();

  const [{ data: business }, { data: template }, { data: runs }, { data: contentHistory }] = await Promise.all([
    supabase.from("businesses").select("name").eq("id", automation.business_id).single(),
    supabase.from("automation_templates").select("name, slug").eq("id", automation.template_id).single(),
    supabase
      .from("automation_runs")
      .select("*")
      .eq("automation_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("content_history")
      .select("*")
      .eq("automation_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const schedule = automation.schedule as unknown as AutomationSchedule;
  const parsedBlog = template?.slug === "blog-marketing" ? blogSetupSchema.safeParse(automation.config) : null;
  const blogConfig = parsedBlog?.success ? automation.config as unknown as BlogAutomationConfig : null;
  const latestSuccessfulRun = (runs ?? []).find((run) => run.status === "SUCCESS");
  const latestOutput = latestSuccessfulRun ? resultOutput(latestSuccessfulRun.output) : null;
  const hasInFlightRun = (runs ?? []).some((run) => run.status === "QUEUED" || run.status === "RUNNING");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{automation.name}</h1>
            <Badge>{STATUS_LABEL[automation.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {business?.name} · {template?.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RunNowButton automationId={automation.id} hasInFlightRun={hasInFlightRun} />
          <AutomationStatusActions automationId={automation.id} status={automation.status} primary={Boolean(blogConfig)} />
        </div>
      </div>

      {blogConfig && <Card>
        <CardHeader><CardTitle className="text-base">블로그 자동화 설정 요약</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          {automation.status === "DRAFT" && <p className="rounded-md bg-primary/5 p-3 text-foreground">설정이 저장되었습니다. 내용을 확인한 뒤 <strong>활성화</strong>를 누르면 예약 실행이 시작됩니다. Run Now를 누르면 즉시 1회 실행됩니다. 바로 발행을 선택했다면 글이 공개 게시됩니다.</p>}
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div><dt className="text-muted-foreground">사업체</dt><dd className="font-medium">{business?.name ?? "-"}</dd></div>
            <div><dt className="text-muted-foreground">게시 목적</dt><dd className="font-medium">{blogConfig.objective}</dd></div>
            <div><dt className="text-muted-foreground">키워드</dt><dd className="font-medium">{blogConfig.keywords.join(", ")}</dd></div>
            <div><dt className="text-muted-foreground">글의 톤</dt><dd className="font-medium">{blogConfig.tone}</dd></div>
            <div><dt className="text-muted-foreground">저장 위치</dt><dd className="font-medium">{BLOG_DELIVERY_LABEL[blogConfig.deliveryMode]}</dd></div>
            {blogConfig.wordpress && <div><dt className="text-muted-foreground">WordPress 연결</dt><dd className="font-medium">{blogConfig.wordpress.siteUrl} · {blogConfig.wordpress.username}</dd></div>}
          </dl>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">실행 주기</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {schedule?.frequency === "WEEKLY"
            ? `매주 ${(schedule.daysOfWeek ?? []).map((d) => WEEKDAY_LABEL[d]).join(", ")}요일 ${schedule.timeOfDay}`
            : `매일 ${schedule?.timeOfDay}`}{" "}
          (KST)
          {automation.next_run_at ? (
            <span className="block">다음 실행: {new Date(automation.next_run_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST)</span>
          ) : null}
        </CardContent>
      </Card>

      {latestOutput && <Card>
        <CardHeader><CardTitle className="text-base">최근 성공한 실행 결과</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">{new Date(latestSuccessfulRun!.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (KST)</p>
          {typeof latestOutput.title === "string" && <div><span className="text-muted-foreground">AI 생성 제목</span><p className="font-medium">{latestOutput.title}</p></div>}
          {typeof latestOutput.topic === "string" && <div><span className="text-muted-foreground">AI 선택 주제</span><p className="font-medium">{latestOutput.topic}</p></div>}
          {typeof latestOutput.externalUrl === "string" && latestOutput.externalUrl ? <div><span className="text-muted-foreground">WordPress {latestOutput.wordpressStatus === "draft" ? "초안 URL (WordPress 로그인 필요)" : "게시 URL"}</span><p><a href={latestOutput.externalUrl} target="_blank" rel="noreferrer" className="break-all text-primary underline">{latestOutput.externalUrl}</a></p></div> : <p className="text-muted-foreground">WordPress URL 없음 · 앱에 콘텐츠가 저장되었습니다.</p>}
        </CardContent>
      </Card>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">실행 히스토리</CardTitle>
        </CardHeader>
        <CardContent>
          {(runs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 실행 기록이 없습니다. Run Now를 눌러 테스트해보세요.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>시각</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>오류</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs ?? []).map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{new Date(run.created_at).toLocaleString("ko-KR")}</TableCell>
                    <TableCell>
                      <Badge
                        variant={run.status === "SUCCESS" ? "default" : run.status === "FAILED" ? "destructive" : "secondary"}
                      >
                        {RUN_STATUS_LABEL[run.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.status === "FAILED" ? (
                        <Link href={`/automations/${automation.id}/runs/${run.id}`} className="text-red-700 underline-offset-2 hover:underline">
                          오류 상세 보기
                        </Link>
                      ) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(contentHistory ?? []).length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">생성된 콘텐츠</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(contentHistory ?? []).map((item) => (
              <div key={item.id} className="border-b pb-4 last:border-0 last:pb-0">
                <p className="font-medium">{item.title}</p>
                {item.topic && <p className="text-xs text-muted-foreground">주제: {item.topic}</p>}
                <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("ko-KR")}</p>
                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{item.content}</p>
                {item.external_url ? (
                  <a href={item.external_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-primary underline">
                    WordPress 글 보기
                  </a>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
