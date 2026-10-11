import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getUsageHistory,
  type UsageHistoryFilters,
  type UsageHistoryItem,
  type UsageHistoryStatusFilter,
} from "@/server/billing/read-model";
import type { CreditKind } from "@/server/billing/products";
import { RunStatusBadge } from "@/components/automations/run-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { PageHeader } from "@/components/layout/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type PeriodFilter = "7d" | "30d" | "90d" | "all";

const PERIOD_OPTIONS: Array<{ value: PeriodFilter; label: string }> = [
  { value: "7d", label: "최근 7일" },
  { value: "30d", label: "최근 30일" },
  { value: "90d", label: "최근 90일" },
  { value: "all", label: "전체 기간" },
];
const KIND_OPTIONS: Array<{ value: CreditKind | "ALL"; label: string }> = [
  { value: "ALL", label: "모든 기능" },
  { value: "BLOG", label: "블로그" },
  { value: "SHORTS", label: "숏폼" },
];
const STATUS_OPTIONS: Array<{ value: UsageHistoryStatusFilter | "ALL"; label: string }> = [
  { value: "ALL", label: "모든 상태" },
  { value: "SUCCESS", label: "완료" },
  { value: "FAILED", label: "실패" },
  { value: "RUNNING", label: "진행 중" },
  { value: "GRANTED", label: "지급" },
  { value: "RETURNED", label: "반환" },
  { value: "EXPIRED", label: "만료" },
  { value: "REFUNDED", label: "환불" },
];

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  hour12: false,
  timeZone: "Asia/Seoul",
});

const selectClassName = "h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePeriod(value: string | undefined): PeriodFilter {
  return PERIOD_OPTIONS.some((option) => option.value === value) ? value as PeriodFilter : "30d";
}

function parseKind(value: string | undefined): CreditKind | null {
  return value === "BLOG" || value === "SHORTS" ? value : null;
}

function parseStatus(value: string | undefined): UsageHistoryStatusFilter | null {
  return STATUS_OPTIONS.some((option) => option.value === value && option.value !== "ALL")
    ? value as UsageHistoryStatusFilter
    : null;
}

function periodRange(period: PeriodFilter): Pick<UsageHistoryFilters, "from" | "to"> {
  if (period === "all") return { from: null, to: null };
  const days = Number.parseInt(period, 10);
  return { from: new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString(), to: null };
}

function usageHref(period: PeriodFilter, kind: CreditKind | null, status: UsageHistoryStatusFilter | null, page = 1) {
  const params = new URLSearchParams();
  if (period !== "30d") params.set("period", period);
  if (kind) params.set("kind", kind);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/usage${query ? `?${query}` : ""}`;
}

function safeExternalUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function UsageStatusBadge({ item }: { item: UsageHistoryItem }) {
  if (item.runStatus) return <RunStatusBadge status={item.runStatus} />;
  if (item.eventType === "GRANT") return <Badge variant="success">지급</Badge>;
  if (item.eventType === "EXPIRE") return <Badge variant="warning">만료</Badge>;
  if (item.eventType === "REFUND") return <Badge variant="secondary">환불</Badge>;
  if (item.terminalEvent === "RELEASE") return <Badge variant="brand">반환</Badge>;
  return <Badge variant="secondary">처리됨</Badge>;
}

function CreditChange({ item }: { item: UsageHistoryItem }) {
  if (item.eventType === "GRANT") return <span className="font-bold text-success">+{item.delta}회 지급</span>;
  if (item.eventType === "EXPIRE") return <span className="font-semibold text-muted-foreground">{Math.abs(item.delta)}회 만료</span>;
  if (item.eventType === "REFUND") return <span className="font-semibold text-muted-foreground">{Math.abs(item.delta)}회 환불 회수</span>;
  if (item.terminalEvent === "RELEASE") {
    return <span className="font-semibold"><span className="text-muted-foreground">{item.delta}회 예약</span><span className="mx-1">·</span><span className="text-success">+{item.terminalDelta ?? Math.abs(item.delta)}회 반환</span></span>;
  }
  if (item.terminalEvent === "SETTLE" || item.runStatus === "SUCCESS") return <span className="font-bold">{item.delta}회 차감</span>;
  return <span className="font-semibold text-muted-foreground">{item.delta}회 예약</span>;
}

function ResultLinks({ item }: { item: UsageHistoryItem }) {
  const externalUrl = safeExternalUrl(item.externalUrl);
  const detailHref = item.automationId && item.runId ? `/automations/${item.automationId}/runs/${item.runId}` : null;
  if (!detailHref && !externalUrl) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="flex flex-wrap justify-end gap-x-3 gap-y-1">
      {detailHref ? <Link href={detailHref} className="font-semibold text-primary hover:underline">결과 보기</Link> : null}
      {externalUrl ? <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">게시물 <ExternalLink className="size-3.5" aria-hidden="true" /></a> : null}
    </span>
  );
}

export default async function UsagePage({ searchParams }: PageProps<"/usage">) {
  const params = await searchParams;
  const period = parsePeriod(firstParam(params.period));
  const kind = parseKind(firstParam(params.kind));
  const status = parseStatus(firstParam(params.status));
  const requestedPage = Number.parseInt(firstParam(params.page) ?? "1", 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { items, total, pageSize } = await getUsageHistory({ kind, status, ...periodRange(period) }, page);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > 1 && (items.length === 0 || page > totalPages)) redirect(usageHref(period, kind, status, totalPages));
  const hasFilters = Boolean(kind || status || period !== "30d");
  const emptyAction = period === "all"
    ? { href: "/usage?period=all", label: "필터 초기화" }
    : { href: usageHref("all", kind, status), label: "전체 기간 보기" };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title="이용내역" description={`콘텐츠 제작과 이용권 지급·차감·반환·만료를 시간순으로 확인하세요. 총 ${total.toLocaleString()}건`} />

      <form method="get" className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto_auto] lg:items-end" aria-label="이용내역 필터">
        <label className="grid gap-1.5 text-sm font-semibold">기간
          <select name="period" defaultValue={period} className={selectClassName}>
            {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">사용 기능
          <select name="kind" defaultValue={kind ?? "ALL"} className={selectClassName}>
            {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold">상태
          <select name="status" defaultValue={status ?? "ALL"} className={selectClassName}>
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <Button type="submit">적용</Button>
        <Button asChild variant="outline"><Link href="/usage">초기화</Link></Button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          mascot="guide"
          title={hasFilters ? "조건에 맞는 이용내역이 없어요" : "아직 이용내역이 없어요"}
          description="콘텐츠를 만들거나 이용권을 받으면 여기에 시간순으로 표시돼요."
          action={hasFilters ? <Button asChild variant="outline"><Link href={emptyAction.href}>{emptyAction.label}</Link></Button> : <Button asChild><Link href="/calendar">마케팅 캘린더로</Link></Button>}
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border bg-card">
            <Table className="hidden min-w-[820px] md:table">
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="pl-6">날짜·시간</TableHead>
                  <TableHead>사용 기능</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>이용권</TableHead>
                  <TableHead className="pr-6 text-right">결과</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="tabular pl-6 text-muted-foreground">{dateFormatter.format(new Date(item.createdAt))}</TableCell>
                    <TableCell><p className="font-semibold">{item.kind === "BLOG" ? "블로그" : "숏폼"}</p>{item.contentTitle || item.automationName ? <p className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground">{item.contentTitle ?? item.automationName}</p> : null}</TableCell>
                    <TableCell><UsageStatusBadge item={item} /></TableCell>
                    <TableCell className="tabular text-sm"><CreditChange item={item} /></TableCell>
                    <TableCell className="pr-6 text-right text-sm"><ResultLinks item={item} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <ul className="divide-y md:hidden">
              {items.map((item) => (
                <li key={item.id} className="space-y-3 px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-bold">{item.kind === "BLOG" ? "블로그" : "숏폼"}</p>{item.contentTitle || item.automationName ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.contentTitle ?? item.automationName}</p> : null}</div>
                    <UsageStatusBadge item={item} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <time className="tabular text-muted-foreground" dateTime={item.createdAt}>{dateFormatter.format(new Date(item.createdAt))}</time>
                    <CreditChange item={item} />
                  </div>
                  <div className="text-right text-sm"><ResultLinks item={item} /></div>
                </li>
              ))}
            </ul>
          </div>

          {totalPages > 1 ? (
            <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="이용내역 페이지">
              {page <= 1 ? <Button variant="outline" disabled><ChevronLeft /> 이전</Button> : <Button asChild variant="outline"><Link href={usageHref(period, kind, status, page - 1)}><ChevronLeft /> 이전</Link></Button>}
              <p className="tabular text-sm text-muted-foreground">{page} / {totalPages}</p>
              {page >= totalPages ? <Button variant="outline" disabled>다음 <ChevronRight /></Button> : <Button asChild variant="outline"><Link href={usageHref(period, kind, status, page + 1)}>다음 <ChevronRight /></Link></Button>}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
