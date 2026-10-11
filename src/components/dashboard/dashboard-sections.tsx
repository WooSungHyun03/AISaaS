import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ExternalLink,
  FileText,
  Minus,
  ReceiptText,
  Sparkles,
} from "lucide-react";
import { Mascot } from "@/components/brand/mascot";
import { RunStatusBadge } from "@/components/automations/run-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { safeExternalUrl } from "@/lib/safe-external-url";
import { cn } from "@/lib/utils";
import { GROWTH_METRIC_LABEL } from "@/server/channels/growth-series";
import { PLATFORM_LABEL } from "@/server/channels/platform";
import type { ChannelDiagnosisSummary, GrowthSummary } from "@/server/channels/types";
import type { CreditBalance } from "@/server/billing/run-credits";
import type { UsageHistoryItem } from "@/server/billing/read-model";
import type {
  DashboardCalendarItem,
  DashboardNextAction,
  DashboardRecentContent,
} from "@/server/dashboard/overview";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

const CALENDAR_PLATFORM = {
  blog: { label: "블로그", className: "bg-brand-soft text-primary" },
  instagram_reels: { label: "인스타 릴스", className: "bg-warning-soft text-warning" },
  youtube_shorts: { label: "유튜브 쇼츠", className: "bg-success-soft text-success" },
} as const;

const CALENDAR_STATUS = {
  PLANNED: "계획",
  GENERATED: "생성됨",
  PUBLISHED: "게시됨",
  SKIPPED: "건너뜀",
} as const;

function SectionShell({
  id,
  title,
  description,
  href,
  linkLabel = "전체 보기",
  className,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  href?: string;
  linkLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("rounded-2xl border border-border bg-card p-5 sm:p-6", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id={id} className="text-lg font-extrabold tracking-[-0.03em]">{title}</h2>
          {description ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {href ? (
          <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary hover:underline">
            {linkLabel} <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function CompactEmpty({ title, description, href, cta }: { title: string; description: string; href: string; cta: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-5 py-6 text-center">
      <p className="font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      <Button asChild size="sm" variant="outline" className="mt-4"><Link href={href}>{cta}</Link></Button>
    </div>
  );
}

export function DashboardSectionSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-5 sm:p-6", className)} role="status" aria-label="대시보드 영역 불러오는 중">
      <div className="flex justify-between gap-4"><div className="space-y-2"><Skeleton className="h-6 w-32" /><Skeleton className="h-4 w-52 max-w-full" /></div><Skeleton className="h-5 w-16" /></div>
      <div className="mt-5 space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
    </div>
  );
}

export async function NextActionSection({ actionPromise }: { actionPromise: Promise<DashboardNextAction> }) {
  const action = await actionPromise;
  const pose = action.stage === "GROWTH" ? "thumbsUp" : action.stage === "BUSINESS" ? "welcome" : "guide";
  return (
    <section aria-labelledby="next-action-title" className="overflow-hidden rounded-2xl bg-brand-soft">
      <div className="grid items-center gap-5 px-6 py-7 sm:px-8 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-primary">{action.eyebrow}</p>
          <h2 id="next-action-title" className="mt-2 text-2xl font-extrabold tracking-[-0.04em] sm:text-[1.75rem]">{action.title}</h2>
          <p className="mt-2 text-[15px] leading-7 text-muted-foreground">{action.description}</p>
          <Button asChild size="lg" className="mt-5"><Link href={action.href}>{action.cta} <ArrowRight aria-hidden="true" /></Link></Button>
        </div>
        <Mascot pose={pose} size={170} className="mx-auto hidden w-[150px] md:block lg:w-[170px]" />
      </div>
    </section>
  );
}

export async function CreditsSection({ creditsPromise }: { creditsPromise: Promise<Record<"BLOG" | "SHORTS", CreditBalance>> }) {
  const credits = await creditsPromise;
  return (
    <SectionShell id="credits-title" title="남은 콘텐츠 이용권" description="콘텐츠 제작에 사용할 수 있는 횟수예요." href="/billing" linkLabel="구매·관리">
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        {([
          ["BLOG", "블로그", FileText],
          ["SHORTS", "숏폼", Sparkles],
        ] as const).map(([kind, label, Icon]) => {
          const balance = credits[kind];
          return (
            <div key={kind} className="rounded-xl bg-muted/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-primary" aria-hidden="true" />{label}</dt>
                <dd className="tabular text-2xl font-extrabold">{balance.remaining}<span className="ml-1 text-sm font-semibold text-muted-foreground">회</span></dd>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{balance.nextExpiry ? `${dateFormatter.format(new Date(balance.nextExpiry))} 먼저 만료` : "사용 가능한 이용권이 없어요"}</p>
            </div>
          );
        })}
      </dl>
    </SectionShell>
  );
}

export async function DiagnosisSummarySection({ diagnosisPromise }: { diagnosisPromise: Promise<ChannelDiagnosisSummary | null> }) {
  const diagnosis = await diagnosisPromise;
  if (!diagnosis?.hasAnyData) {
    return (
      <SectionShell id="diagnosis-title" title="마케팅 진단 요약" description="등록한 채널의 운영 상태를 확인해요." href="/diagnosis">
        <CompactEmpty title="아직 진단 결과가 없어요" description="채널 주소를 등록하고 첫 진단을 시작하면 점수와 개선할 일을 보여드려요." href="/diagnosis" cta="마케팅 진단하기" />
      </SectionShell>
    );
  }
  const average = Math.round(diagnosis.channels.reduce((sum, item) => sum + item.overallScore, 0) / diagnosis.channels.length);
  return (
    <SectionShell id="diagnosis-title" title="마케팅 진단 요약" description={`${diagnosis.channels.length}개 채널의 최신 결과`} href="/diagnosis">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex size-24 shrink-0 flex-col items-center justify-center rounded-full bg-brand-soft text-primary">
          <span className="tabular text-3xl font-black">{average}</span><span className="text-xs font-semibold">평균 점수</span>
        </div>
        <ul className="min-w-0 flex-1 divide-y divide-border">
          {diagnosis.channels.slice(0, 3).map((item) => (
            <li key={item.channelId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0"><p className="font-semibold">{PLATFORM_LABEL[item.channel]}</p><p className="truncate text-xs text-muted-foreground">{item.recommendations[0] ?? item.findings[0] ?? "운영 상태를 확인했어요."}</p></div>
              <span className="tabular shrink-0 text-lg font-extrabold">{item.overallScore}<span className="text-xs font-medium text-muted-foreground">점</span></span>
            </li>
          ))}
        </ul>
      </div>
    </SectionShell>
  );
}

export async function CalendarSummarySection({ calendarPromise }: { calendarPromise: Promise<{ items: DashboardCalendarItem[]; total: number; month: string } | null> }) {
  const calendar = await calendarPromise;
  if (!calendar || calendar.total === 0) {
    return (
      <SectionShell id="calendar-title" title="이번 달 마케팅 캘린더" description="날짜별 콘텐츠 계획을 확인해요." href="/calendar">
        <CompactEmpty title="이번 달 계획이 비어 있어요" description="사업 정보와 진단 결과를 바탕으로 2~4주 콘텐츠 계획을 한 번에 만들 수 있어요." href="/calendar" cta="캘린더 만들기" />
      </SectionShell>
    );
  }
  return (
    <SectionShell id="calendar-title" title="이번 달 마케팅 캘린더" description={`${Number(calendar.month.slice(5))}월 계획 ${calendar.total}건`} href="/calendar">
      <ul className="divide-y divide-border">
        {calendar.items.map((item) => {
          const platform = CALENDAR_PLATFORM[item.platform];
          return (
            <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <time dateTime={item.plannedDate} className="flex size-11 shrink-0 flex-col items-center justify-center rounded-lg bg-muted text-center" aria-label={`${Number(item.plannedDate.slice(5, 7))}월 ${Number(item.plannedDate.slice(8, 10))}일`}>
                <CalendarDays className="size-3.5 text-primary" aria-hidden="true" /><span className="tabular mt-0.5 text-[10px] font-bold">{Number(item.plannedDate.slice(5, 7))}/{Number(item.plannedDate.slice(8, 10))}</span>
              </time>
              <div className="min-w-0 flex-1"><p className="line-clamp-2 font-semibold leading-6">{item.topic}</p><div className="mt-1.5 flex flex-wrap gap-1.5"><Badge className={platform.className}>{platform.label}</Badge><Badge variant="outline">{CALENDAR_STATUS[item.status]}</Badge></div></div>
            </li>
          );
        })}
      </ul>
      {calendar.total > calendar.items.length ? <p className="mt-4 text-center text-xs text-muted-foreground">외 {calendar.total - calendar.items.length}건의 계획이 더 있어요.</p> : null}
    </SectionShell>
  );
}

export async function RecentContentSection({ contentPromise }: { contentPromise: Promise<DashboardRecentContent[] | null> }) {
  const items = await contentPromise;
  if (!items?.length) {
    return (
      <SectionShell id="content-title" title="최근 생성 콘텐츠" description="최근 만든 블로그 글과 숏폼이에요." href="/blog">
        <CompactEmpty title="아직 만든 콘텐츠가 없어요" description="캘린더의 주제를 선택해 첫 블로그 글이나 숏폼을 만들어보세요." href="/calendar" cta="첫 콘텐츠 만들기" />
      </SectionShell>
    );
  }
  return (
    <SectionShell id="content-title" title="최근 생성 콘텐츠" description="최근 만든 블로그 글과 숏폼이에요." href="/blog">
      <ul className="divide-y divide-border">
        {items.map((item) => {
          const detailHref = item.runId ? `/automations/${item.automationId}/runs/${item.runId}` : null;
          const externalUrl = safeExternalUrl(item.externalUrl);
          return (
            <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-primary"><FileText className="size-4" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1"><p className="truncate font-semibold">{item.title || item.topic || "제목 없는 콘텐츠"}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.contentType === "shorts" ? "숏폼" : "블로그"} · {dateFormatter.format(new Date(item.createdAt))}</p></div>
              <span className="flex shrink-0 gap-2 text-xs font-semibold text-primary">{detailHref ? <Link href={detailHref} className="hover:underline">결과</Link> : null}{externalUrl ? <a href={externalUrl} target="_blank" rel="noopener noreferrer" aria-label="게시된 콘텐츠 열기"><ExternalLink className="size-4" aria-hidden="true" /></a> : null}</span>
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}

function usageLabel(item: UsageHistoryItem) {
  if (item.eventType === "GRANT") return { status: "지급", credit: `+${item.delta}회`, variant: "success" as const };
  if (item.eventType === "EXPIRE") return { status: "만료", credit: `${Math.abs(item.delta)}회`, variant: "warning" as const };
  if (item.eventType === "REFUND") return { status: "환불", credit: `${Math.abs(item.delta)}회`, variant: "secondary" as const };
  if (item.terminalEvent === "RELEASE") return { status: "반환", credit: `+${item.terminalDelta ?? Math.abs(item.delta)}회`, variant: "brand" as const };
  return { status: null, credit: `${item.delta}회`, variant: "secondary" as const };
}

export async function RecentUsageSection({ usagePromise }: { usagePromise: Promise<UsageHistoryItem[]> }) {
  const items = await usagePromise;
  if (!items.length) {
    return (
      <SectionShell id="usage-title" title="최근 이용내역" description="이용권 지급·차감·반환 기록이에요." href="/usage">
        <CompactEmpty title="아직 이용내역이 없어요" description="콘텐츠를 만들거나 이용권을 받으면 여기에 시간순으로 표시돼요." href="/calendar" cta="콘텐츠 계획 보기" />
      </SectionShell>
    );
  }
  return (
    <SectionShell id="usage-title" title="최근 이용내역" description="이용권 지급·차감·반환 기록이에요." href="/usage">
      <ul className="divide-y divide-border">
        {items.map((item) => {
          const label = usageLabel(item);
          return (
            <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><ReceiptText className="size-4" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1"><p className="truncate font-semibold">{item.contentTitle ?? item.automationName ?? (item.kind === "BLOG" ? "블로그 이용권" : "숏폼 이용권")}</p><p className="mt-0.5 text-xs text-muted-foreground">{item.kind === "BLOG" ? "블로그" : "숏폼"} · {dateFormatter.format(new Date(item.createdAt))}</p></div>
              <div className="shrink-0 text-right">{item.runStatus ? <RunStatusBadge status={item.runStatus} /> : <Badge variant={label.variant}>{label.status}</Badge>}<p className={cn("tabular mt-1 text-xs font-bold", label.credit.startsWith("+") ? "text-success" : "text-muted-foreground")}>{label.credit}</p></div>
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}

export async function GrowthSummarySection({ growthPromise }: { growthPromise: Promise<GrowthSummary | null> }) {
  const growth = await growthPromise;
  const trends = growth?.trends.filter((trend) => trend.current !== null).slice(0, 4) ?? [];
  if (!growth?.hasAnyData || trends.length === 0) {
    return (
      <SectionShell id="growth-title" title="성장 요약" description="최근 7일과 이전 7일의 채널 지표를 비교해요." href="/growth-report">
        <CompactEmpty title="성장 데이터를 모으는 중이에요" description="채널을 등록하고 콘텐츠를 운영하면 구독자·조회수·게시 활동의 변화를 보여드려요." href="/growth-report" cta="성장 리포트 보기" />
      </SectionShell>
    );
  }
  return (
    <SectionShell id="growth-title" title="성장 요약" description={`최근 ${growth.days}일과 이전 ${growth.days}일 비교`} href="/growth-report">
      <dl className="grid gap-3 sm:grid-cols-2">
        {trends.map((trend) => {
          const delta = trend.deltaPercent;
          const Icon = delta === null || delta === 0 ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;
          return (
            <div key={`${trend.channelId}-${trend.metric}`} className="rounded-xl bg-muted/60 p-4">
              <dt className="text-xs font-semibold text-muted-foreground">{PLATFORM_LABEL[trend.platform]} · {GROWTH_METRIC_LABEL[trend.metric] ?? trend.metric}</dt>
              <dd className="tabular mt-2 text-2xl font-extrabold">{trend.current?.toLocaleString("ko-KR")}</dd>
              <p className={cn("mt-1 flex items-center gap-1 text-xs font-semibold", delta === null || delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-success" : "text-destructive")}><Icon className="size-3.5" aria-hidden="true" />{delta === null ? "비교 데이터 없음" : `이전 기간보다 ${delta > 0 ? "+" : ""}${delta}%`}</p>
            </div>
          );
        })}
      </dl>
    </SectionShell>
  );
}

