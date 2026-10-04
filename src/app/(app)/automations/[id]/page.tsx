import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { describeAutomationRunError } from "@/server/shared/errors";
import { FormMessage } from "@/components/ui/form-message";
import { PageHeader } from "@/components/layout/page-header";
import { templateTitle } from "@/components/automations/template-card";
import { AutomationStatusBadge, RunStatusBadge } from "@/components/automations/run-badges";
import { RunNowButton } from "@/components/automations/run-now-button";
import { AutomationStatusActions } from "@/components/automations/automation-status-actions";
import { AutomationSettingsDialog } from "@/components/automations/automation-settings-dialog";
import type { AutomationSchedule } from "@/types/automation";
import { BLOG_DELIVERY_LABEL, blogSetupSchema, type BlogAutomationConfig } from "@/types/blog-automation";
import type { Json } from "@/types/domain";

const fmt = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

function resultOutput(value: Json | null): Record<string, Json | undefined> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** Server Actions on this page call the AI / render provider; give them room beyond the 10s default. */
export const maxDuration = 60;

export default async function AutomationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: automation, error: automationError } = await supabase.from("automations")
    .select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (automationError) throw new Error("만들기 설정을 불러오지 못했습니다.", { cause: automationError });
  if (!automation) notFound();

  const [businessResult, businessesResult, templateResult, runsResult, contentResult, inFlightResult] = await Promise.all([
    supabase.from("businesses").select("name, keywords, brand_tone").eq("id", automation.business_id).single(),
    supabase.from("businesses").select("id, name").eq("owner_id", user.id).order("name"),
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
    supabase.from("automation_runs").select("id").eq("automation_id", id)
      .in("status", ["QUEUED", "RUNNING"]).limit(1).maybeSingle(),
  ]);
  if (businessResult.error || businessesResult.error || templateResult.error || runsResult.error || contentResult.error || inFlightResult.error) {
    throw new Error("만들기 설정 상세를 불러오지 못했습니다.");
  }
  const business = businessResult.data;
  const businesses = businessesResult.data ?? [];
  const template = templateResult.data;
  const runs = runsResult.data ?? [];
  const contentHistory = contentResult.data ?? [];

  const schedule = automation.schedule as unknown as AutomationSchedule;
  const parsedBlog = template?.slug === "blog-marketing" ? blogSetupSchema.safeParse(automation.config) : null;
  const blogConfig = parsedBlog?.success ? automation.config as unknown as BlogAutomationConfig : null;
  const latestSuccessfulRun = (runs ?? []).find((run) => run.status === "SUCCESS");
  const latestOutput = latestSuccessfulRun ? resultOutput(latestSuccessfulRun.output) : null;
  const hasInFlightRun = Boolean(inFlightResult.data);
  const latestRun = runs[0];
  const blogSettings = template?.slug === "blog-marketing" ? {
    objective: blogConfig?.objective ?? "",
    keywords: blogConfig?.keywords ?? business?.keywords ?? [],
    tone: blogConfig?.tone ?? business?.brand_tone ?? "친근하고 전문적인",
    deliveryMode: blogConfig?.deliveryMode ?? "app_draft" as const,
    wordpressSiteUrl: blogConfig?.wordpress?.siteUrl,
    wordpressUsername: blogConfig?.wordpress?.username,
    hasStoredWordPress: Boolean(blogConfig?.wordpress),
    legacy: !blogConfig,
  } : undefined;

  const scheduleText = schedule?.frequency === "WEEKLY"
    ? `매주 ${(schedule.daysOfWeek ?? []).map((d) => WEEKDAY_LABEL[d]).join("·")}요일 ${schedule.timeOfDay}`
    : `매일 ${schedule?.timeOfDay}`;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        back={{ href: "/automations", label: "만들기 설정" }}
        title={automation.name}
        description={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><AutomationStatusBadge status={automation.status} /><span>{business?.name} · {template ? templateTitle(template.slug, template.name) : "콘텐츠"}</span></span>}
        actions={<>
          <AutomationSettingsDialog key={automation.updated_at} automationId={automation.id} name={automation.name} businessId={automation.business_id} businesses={businesses} schedule={schedule} blogSettings={blogSettings} hasInFlightRun={hasInFlightRun} />
          <RunNowButton automationId={automation.id} hasInFlightRun={hasInFlightRun} />
          <AutomationStatusActions automationId={automation.id} status={automation.status} primary={Boolean(blogConfig)} hasInFlightRun={hasInFlightRun} />
        </>}
      />

      {latestRun?.status === "FAILED" && (
        <FormMessage>
          최근에 만들다가 실패했어요. {describeAutomationRunError(latestRun.error_message)}{" "}
          <Link href={`/automations/${automation.id}/runs/${latestRun.id}`} className="font-semibold underline underline-offset-2">자세히 보기</Link>
        </FormMessage>
      )}
      {automation.status === "DRAFT" && blogConfig && (
        <FormMessage variant="info">설정을 저장했어요. 내용을 확인하고 <strong>켜기</strong>를 누르면 정해진 때마다 글 초안을 만들어요. ‘지금 만들기’는 바로 1회 만들어요. 만든 글은 직접 올려주세요.</FormMessage>
      )}

      <section aria-labelledby="summary-heading" className="space-y-4">
        <h2 id="summary-heading" className="text-lg font-extrabold tracking-[-0.03em]">설정 요약</h2>
        <dl className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2">
          <div className="bg-card px-5 py-4"><dt className="text-[13px] font-semibold text-muted-foreground">만드는 주기</dt><dd className="mt-1 font-bold">{scheduleText} <span className="font-normal text-muted-foreground">(한국 시간)</span></dd></div>
          <div className="bg-card px-5 py-4"><dt className="text-[13px] font-semibold text-muted-foreground">다음 제작</dt><dd className="mt-1 font-bold">{automation.next_run_at && automation.status === "ACTIVE" ? fmt(automation.next_run_at) : "꺼져 있어요"}</dd></div>
          {blogConfig && <>
            <div className="bg-card px-5 py-4"><dt className="text-[13px] font-semibold text-muted-foreground">글의 목적</dt><dd className="mt-1 font-medium">{blogConfig.objective}</dd></div>
            <div className="bg-card px-5 py-4"><dt className="text-[13px] font-semibold text-muted-foreground">키워드</dt><dd className="mt-1 font-medium">{blogConfig.keywords.join(", ")}</dd></div>
            <div className="bg-card px-5 py-4"><dt className="text-[13px] font-semibold text-muted-foreground">말투</dt><dd className="mt-1 font-medium">{blogConfig.tone}</dd></div>
            <div className="bg-card px-5 py-4"><dt className="text-[13px] font-semibold text-muted-foreground">저장 위치</dt><dd className="mt-1 font-medium">{BLOG_DELIVERY_LABEL[blogConfig.deliveryMode]}{blogConfig.wordpress ? ` · ${blogConfig.wordpress.siteUrl}` : ""}</dd></div>
          </>}
        </dl>
      </section>

      {latestOutput && (
        <section aria-labelledby="latest-heading" className="space-y-3">
          <h2 id="latest-heading" className="text-lg font-extrabold tracking-[-0.03em]">가장 최근에 만든 결과</h2>
          <div className="rounded-2xl border bg-card px-5 py-5 sm:px-6">
            <p className="text-[13px] text-muted-foreground">{fmt(latestSuccessfulRun!.created_at)}</p>
            {typeof latestOutput.title === "string" && <p className="mt-2 text-lg font-bold leading-7">{latestOutput.title}</p>}
            {typeof latestOutput.topic === "string" && <p className="mt-1 text-sm text-muted-foreground">주제 · {latestOutput.topic}</p>}
            <p className="mt-3 text-sm">
              {typeof latestOutput.externalUrl === "string" && latestOutput.externalUrl
                ? <>WordPress {latestOutput.wordpressStatus === "draft" ? "초안" : "글"} · <a href={latestOutput.externalUrl} target="_blank" rel="noreferrer" className="break-all font-semibold text-primary underline underline-offset-2">{latestOutput.externalUrl}</a></>
                : <span className="text-muted-foreground">이지 마케팅에 저장돼 있어요. 아래 ‘만든 콘텐츠’에서 복사해 쓰세요.</span>}
            </p>
          </div>
        </section>
      )}

      <section aria-labelledby="runs-heading" className="space-y-3">
        <h2 id="runs-heading" className="text-lg font-extrabold tracking-[-0.03em]">제작 기록</h2>
        {runs.length === 0 ? (
          <p className="rounded-2xl bg-muted px-5 py-6 text-[15px] text-muted-foreground">아직 만든 기록이 없어요. ‘지금 만들기’를 눌러 먼저 한 번 만들어보세요.</p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {runs.map((run) => (
              <li key={run.id}>
                <Link href={`/automations/${automation.id}/runs/${run.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-brand-soft/50 focus-visible:outline-offset-[-2px] sm:px-6">
                  <span className="tabular w-32 shrink-0 text-sm font-medium">{fmt(run.created_at)}</span>
                  <RunStatusBadge status={run.status} />
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{run.status === "FAILED" ? describeAutomationRunError(run.error_message) : run.status === "SUCCESS" ? "완료" : "진행 중"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {contentHistory.length > 0 ? (
        <section aria-labelledby="content-heading" className="space-y-3">
          <h2 id="content-heading" className="text-lg font-extrabold tracking-[-0.03em]">만든 콘텐츠</h2>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {contentHistory.map((item) => (
              <li key={item.id} className="px-5 py-5 sm:px-6">
                <p className="font-bold leading-7">{item.title}</p>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{item.topic ? `주제 ${item.topic} · ` : ""}{fmt(item.created_at)}</p>
                <p className="mt-3 whitespace-pre-line text-[15px] leading-7 text-muted-foreground">{item.content}</p>
                {item.external_url ? <a href={item.external_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-2">WordPress 글 보기</a> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
