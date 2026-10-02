import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAutomationRunHistory, type RunHistoryFilter } from "@/server/automations/history";
import { RunSourceBadge, RunStatusBadge } from "@/components/automations/run-badges";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/page-state";

const FILTERS: Array<{ value: RunHistoryFilter | null; label: string }> = [
  { value: null, label: "전체" },
  { value: "SUCCESS", label: "완료" },
  { value: "FAILED", label: "실패" },
  { value: "RUNNING", label: "만드는 중" },
];

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

function formatDate(value: string | null, fallback: string) {
  return value ? dateFormatter.format(new Date(value)) : fallback;
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
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="제작 기록"
        description={`블로그 글과 숏폼을 언제, 어떻게 만들었는지 한눈에 봐요. 총 ${total.toLocaleString()}건 (한국 시간)`}
      />

      <nav className="flex flex-wrap gap-2" aria-label="상태별 보기">
        {FILTERS.map((filter) => {
          const active = status === filter.value;
          return (
            <Link
              key={filter.value ?? "ALL"}
              href={historyHref(filter.value)}
              aria-current={active ? "page" : undefined}
              className={cn(buttonVariants({ variant: active ? "default" : "outline", size: "sm" }), "h-9 rounded-full px-4")}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {runs.length === 0 ? (
        <EmptyState
          mascot="guide"
          title={status ? "이 상태의 기록이 없어요" : "아직 만든 기록이 없어요"}
          description="콘텐츠를 만들면 시작과 완료 상태가 여기에 쌓여요."
          action={status ? <Button asChild variant="outline"><Link href="/automations/history">전체 기록 보기</Link></Button> : <Button asChild><Link href="/automations">만들기 설정으로</Link></Button>}
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border bg-card">
            <Table className="hidden min-w-[760px] md:table">
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="pl-6">설정</TableHead>
                  <TableHead>방식</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>시작</TableHead>
                  <TableHead>완료</TableHead>
                  <TableHead className="pr-6 text-right"><span className="sr-only">상세</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="max-w-[260px] pl-6">
                      <Link href={`/automations/${run.automationId}`} className="block truncate font-semibold hover:text-primary hover:underline">{run.automationName}</Link>
                    </TableCell>
                    <TableCell><RunSourceBadge source={run.source} /></TableCell>
                    <TableCell><RunStatusBadge status={run.status} /></TableCell>
                    <TableCell className="tabular text-muted-foreground">{formatDate(run.startedAt, "대기 중")}</TableCell>
                    <TableCell className="tabular text-muted-foreground">{formatDate(run.completedAt, run.status === "RUNNING" ? "만드는 중" : "-")}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <Link href={`/automations/${run.automationId}/runs/${run.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                        자세히 <ChevronRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ul className="divide-y md:hidden">
              {runs.map((run) => (
                <li key={run.id}>
                  <Link href={`/automations/${run.automationId}/runs/${run.id}`} className="block space-y-2 px-5 py-4 transition-colors hover:bg-brand-soft/50">
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate font-bold">{run.automationName}</span>
                      <RunStatusBadge status={run.status} />
                    </span>
                    <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <RunSourceBadge source={run.source} />
                      <span className="tabular">{formatDate(run.startedAt, "대기 중")}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {totalPages > 1 ? (
            <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="제작 기록 페이지">
              {page <= 1 ? <Button variant="outline" disabled><ChevronLeft /> 이전</Button> : (
                <Button asChild variant="outline"><Link href={historyHref(status, page - 1)}><ChevronLeft /> 이전</Link></Button>
              )}
              <p className="tabular text-sm text-muted-foreground">{page} / {totalPages}</p>
              {page >= totalPages ? <Button variant="outline" disabled>다음 <ChevronRight /></Button> : (
                <Button asChild variant="outline"><Link href={historyHref(status, page + 1)}>다음 <ChevronRight /></Link></Button>
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
