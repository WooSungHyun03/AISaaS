import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RunNowButton } from "@/components/automations/run-now-button";
import { AutomationStatusActions } from "@/components/automations/automation-status-actions";
import type { AutomationSchedule } from "@/types/automation";

const STATUS_LABEL: Record<string, string> = { DRAFT: "초안", ACTIVE: "실행중", PAUSED: "일시정지", ERROR: "오류" };
const RUN_STATUS_LABEL: Record<string, string> = {
  QUEUED: "대기중",
  RUNNING: "실행중",
  SUCCESS: "성공",
  FAILED: "실패",
};
const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

export default async function AutomationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: automation } = await supabase.from("automations").select("*").eq("id", id).single();
  if (!automation) notFound();

  const [{ data: business }, { data: template }, { data: runs }, { data: contentHistory }] = await Promise.all([
    supabase.from("businesses").select("name").eq("id", automation.business_id).single(),
    supabase.from("automation_templates").select("name").eq("id", automation.template_id).single(),
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{automation.name}</h1>
            <Badge>{STATUS_LABEL[automation.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {business?.name} · {template?.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RunNowButton automationId={automation.id} />
          <AutomationStatusActions automationId={automation.id} status={automation.status} />
        </div>
      </div>

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
            <span className="block">다음 실행: {new Date(automation.next_run_at).toLocaleString("ko-KR")}</span>
          ) : null}
        </CardContent>
      </Card>

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
                <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("ko-KR")}</p>
                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{item.content}</p>
                {item.external_url ? (
                  <a href={item.external_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-primary underline">
                    게시된 콘텐츠 보기
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
