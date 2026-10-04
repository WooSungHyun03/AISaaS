import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { AutomationSettingsDialog } from "@/components/automations/automation-settings-dialog";
import { RunNowButton } from "@/components/automations/run-now-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { describeSchedule } from "@/server/automations/schedule-input";
import type { AutomationSchedule } from "@/types/automation";
import { blogSetupSchema, type BlogAutomationConfig } from "@/types/blog-automation";

const fmt = (value: string) =>
  new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Server Actions on this page call the AI / render provider; give them room beyond the 10s default. */
export const maxDuration = 60;

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: businesses, error: businessError } = await supabase
    .from("businesses")
    .select("id, name, keywords, brand_tone")
    .eq("owner_id", user.id)
    .order("created_at");
  if (businessError) throw new Error("사업체 정보를 불러오지 못했습니다.", { cause: businessError });

  const selectedBusiness = businesses?.find((business) => business.id === query.business) ?? businesses?.[0];
  if (!selectedBusiness) {
    return (
      <div className="mx-auto max-w-4xl space-y-8">
        <PageHeading />
        <EmptyState
          mascot="point"
          title="아직 사업체가 없어요"
          description="먼저 사업체를 등록하면 블로그 글 만들기를 시작할 수 있어요."
          action={<Button asChild><Link href="/business">사업체 등록하기</Link></Button>}
        />
      </div>
    );
  }

  const { data: template, error: templateError } = await supabase
    .from("automation_templates")
    .select("id")
    .eq("slug", "blog-marketing")
    .maybeSingle();
  if (templateError) throw new Error("블로그 자동화 템플릿을 확인하지 못했습니다.", { cause: templateError });

  const { data: automations, error: automationsError } = template
    ? await supabase
      .from("automations")
      .select("*")
      .eq("user_id", user.id)
      .eq("business_id", selectedBusiness.id)
      .eq("template_id", template.id)
      .order("created_at")
    : { data: [], error: null };
  if (automationsError) throw new Error("블로그 자동화를 불러오지 못했습니다.", { cause: automationsError });

  const businessPickers = businesses?.length && businesses.length > 1 ? (
    <nav className="flex flex-wrap gap-2" aria-label="사업체 선택">
      {businesses.map((business) => (
        <Button key={business.id} asChild size="sm" variant={business.id === selectedBusiness.id ? "default" : "outline"}>
          <Link href={`/blog?business=${business.id}`} aria-current={business.id === selectedBusiness.id ? "page" : undefined}>{business.name}</Link>
        </Button>
      ))}
    </nav>
  ) : null;

  if (!automations || automations.length === 0) {
    return (
      <div className="mx-auto max-w-4xl space-y-8">
        <PageHeading />
        {businessPickers}
        <EmptyState
          mascot="point"
          title={`${selectedBusiness.name}에는 아직 블로그 글 만들기 설정이 없어요`}
          description="설정을 만들면 정해진 때마다 새 글 초안을 만들어드려요."
          action={<Button asChild><Link href="/automations/new?template=blog-marketing">블로그 글 만들기 설정하기</Link></Button>}
        />
      </div>
    );
  }

  const automationIds = automations.map((automation) => automation.id);
  const [contentResult, inFlightResult, businessOwnerBusinesses] = await Promise.all([
    supabase
      .from("content_history")
      .select("*")
      .in("automation_id", automationIds)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("automation_runs")
      .select("automation_id")
      .in("automation_id", automationIds)
      .in("status", ["QUEUED", "RUNNING"]),
    supabase.from("businesses").select("id, name").eq("owner_id", user.id).order("name"),
  ]);
  if (contentResult.error || inFlightResult.error || businessOwnerBusinesses.error) {
    throw new Error("블로그 콘텐츠를 불러오지 못했습니다.");
  }

  const contentByAutomation = new Map<string, typeof contentResult.data>();
  for (const item of contentResult.data ?? []) {
    const list = contentByAutomation.get(item.automation_id) ?? [];
    list.push(item);
    contentByAutomation.set(item.automation_id, list);
  }
  const inFlightAutomationIds = new Set((inFlightResult.data ?? []).map((run) => run.automation_id));
  const businessPickerList = businessOwnerBusinesses.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <PageHeading />
      {businessPickers}

      {automations.map((automation) => {
        const schedule = automation.schedule as unknown as AutomationSchedule;
        const parsedBlog = blogSetupSchema.safeParse(automation.config);
        const blogConfig = parsedBlog.success ? (automation.config as unknown as BlogAutomationConfig) : null;
        const blogSettings = {
          objective: blogConfig?.objective ?? "",
          keywords: blogConfig?.keywords ?? selectedBusiness.keywords ?? [],
          tone: blogConfig?.tone ?? selectedBusiness.brand_tone ?? "친근하고 전문적인",
          deliveryMode: blogConfig?.deliveryMode ?? ("app_draft" as const),
          wordpressSiteUrl: blogConfig?.wordpress?.siteUrl,
          wordpressUsername: blogConfig?.wordpress?.username,
          hasStoredWordPress: Boolean(blogConfig?.wordpress),
          legacy: !blogConfig,
        };
        const hasInFlightRun = inFlightAutomationIds.has(automation.id);
        const items = contentByAutomation.get(automation.id) ?? [];
        const scheduleText = describeSchedule(schedule);

        return (
          <section key={automation.id} aria-labelledby={`blog-automation-${automation.id}`} className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <h2 id={`blog-automation-${automation.id}`} className="font-bold leading-6">{automation.name}</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">{scheduleText} (한국 시간) · <Link href={`/automations/${automation.id}`} className="underline underline-offset-2">자세히 보기</Link></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <AutomationSettingsDialog
                  key={automation.updated_at}
                  automationId={automation.id}
                  name={automation.name}
                  businessId={automation.business_id}
                  businesses={businessPickerList}
                  schedule={schedule}
                  blogSettings={blogSettings}
                  hasInFlightRun={hasInFlightRun}
                />
                <RunNowButton automationId={automation.id} hasInFlightRun={hasInFlightRun} />
              </div>
            </div>

            {items.length === 0 ? (
              <p className="rounded-2xl bg-muted px-5 py-6 text-[15px] text-muted-foreground">아직 만든 글이 없어요. 위에서 ‘지금 만들기’를 눌러보세요.</p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                {items.map((item) => (
                  <li key={item.id}>
                    {item.run_id ? (
                      <Link
                        href={`/automations/${item.automation_id}/runs/${item.run_id}`}
                        className="flex flex-col gap-1 px-5 py-4 transition-colors hover:bg-brand-soft/50 focus-visible:outline-offset-[-2px] sm:px-6"
                      >
                        <span className="font-bold leading-6">{item.title ?? "제목 없음"}</span>
                        <span className="text-[13px] text-muted-foreground">{item.topic ? `주제 ${item.topic} · ` : ""}{fmt(item.created_at)}{item.edited_at ? " · 수정함" : " · 열어서 검토·수정하기"}</span>
                      </Link>
                    ) : (
                      <div className="px-5 py-4 sm:px-6">
                        <p className="font-bold leading-6">{item.title ?? "제목 없음"}</p>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">{item.topic ? `주제 ${item.topic} · ` : ""}{fmt(item.created_at)} · <span className="italic">이전 버전에서 만든 글이라 자세히 보기를 열 수 없어요</span></p>
                        {item.content ? <p className="mt-2 whitespace-pre-line text-[15px] leading-7 text-muted-foreground">{item.content}</p> : null}
                        {item.external_url ? <a href={item.external_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-primary underline underline-offset-2">WordPress 글 보기</a> : null}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PageHeading() {
  return (
    <PageHeader
      title="블로그 글 관리"
      description="만든 글을 모아보고, 바로 다시 만들거나 만드는 주기를 바꿀 수 있어요."
    />
  );
}
