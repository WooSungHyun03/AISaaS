import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, Clock3, ExternalLink, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAutomationRunHistory, type RunHistoryFilter } from "@/server/automations/history";
import { RunSourceBadge, RunStatusBadge } from "@/components/automations/run-badges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ value: RunHistoryFilter | null; label: string }> = [
  { value: null, label: "전체" },
  { value: "SUCCESS", label: "성공" },
  { value: "FAILED", label: "실패" },
  { value: "RUNNING", label: "실행 중" },
];

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

function formatDate(value: string | null, fallback: string) {
  return value ? `${dateFormatter.format(new Date(value))} KST` : fallback;
}

function historyHref(status: RunHistoryFilter | null, page?: number) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (page && page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/automations/history${query ? `?${query}` : ""}`;
}

export default async function AutomationHistoryPage({ searchParams }: PageProps<"/automations/history">) {
  const params = await searchParams;
  const status = typeof params.status === "string" && ["SUCCESS", "FAILED", "RUNNING"].includes(params.status)
    ? params.status as RunHistoryFilter
    : null;
  const requestedPage = typeof params.page === "string" ? Number.parseInt(params.page, 10) : 1;
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { runs, total, pageSize } = await getAutomationRunHistory(user.id, status, page);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total > 0 && page > totalPages) redirect(historyHref(status, totalPages));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-700">Automation runs</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">실행 이력</h1>
          <p className="mt-2 text-sm text-muted-foreground">전체 자동화가 언제, 어떤 방식으로 실행되었고 성공했는지 확인하세요.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="size-4" /> 총 {total.toLocaleString()}건
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="실행 상태 필터">
        {FILTERS.map((filter) => {
          const active = status === filter.value;
          return (
            <Link
              key={filter.value ?? "ALL"}
              href={historyHref(filter.value)}
              aria-current={active ? "page" : undefined}
              className={cn(buttonVariants({ variant: active ? "default" : "outline", size: "sm" }), active && "bg-blue-600 text-white hover:bg-blue-700")}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">{status ? `${FILTERS.find((filter) => filter.value === status)?.label} 실행` : "전체 실행"}</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-500"><Clock3 className="size-6" /></span>
              <div>
                <p className="font-medium">{status ? "이 상태의 실행 기록이 없습니다" : "아직 실행 기록이 없습니다"}</p>
                <p className="mt-1 text-sm text-muted-foreground">자동화를 실행하면 시작과 완료 상태가 여기에 기록됩니다.</p>
              </div>
              {status ? <Button asChild variant="outline"><Link href="/automations/history">전체 이력 보기</Link></Button> : <Button asChild><Link href="/automations">자동화 관리</Link></Button>}
            </div>
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">자동화</TableHead>
                  <TableHead>실행 방식</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>시작</TableHead>
                  <TableHead>완료</TableHead>
                  <TableHead><span className="sr-only">상세</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="max-w-[260px] pl-4">
                      <Link href={`/automations/${run.automationId}`} className="block truncate font-medium hover:text-blue-700 hover:underline">{run.automationName}</Link>
                      <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">{run.id.slice(0, 8)}</span>
                    </TableCell>
                    <TableCell><RunSourceBadge source={run.source} /></TableCell>
                    <TableCell><RunStatusBadge status={run.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(run.startedAt, "대기 중")}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(run.completedAt, run.status === "RUNNING" ? "진행 중" : "기록 없음")}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Link href={`/automations/${run.automationId}/runs/${run.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
                        상세 <ExternalLink className="size-3" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between" aria-label="실행 이력 페이지">
          {page <= 1 ? <Button variant="outline" disabled><ChevronLeft /> 이전</Button> : (
            <Button asChild variant="outline"><Link href={historyHref(status, page - 1)}><ChevronLeft /> 이전</Link></Button>
          )}
          <p className="text-sm text-muted-foreground">{page} / {totalPages} 페이지</p>
          {page >= totalPages ? <Button variant="outline" disabled>다음 <ChevronRight /></Button> : (
            <Button asChild variant="outline"><Link href={historyHref(status, page + 1)}>다음 <ChevronRight /></Link></Button>
          )}
        </nav>
      ) : null}
    </div>
  );
}
