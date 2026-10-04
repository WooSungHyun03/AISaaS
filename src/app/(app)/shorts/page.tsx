import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { ShortsCreateButton, ShortsStudio } from "@/components/automations/shorts-studio";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { toSafeAutomationRunOutput } from "@/server/automations/run-output";
import type { AutomationSchedule, ShortsPublishPlatform } from "@/types/automation";

/** Server Actions on this page call the AI / render provider; give them room beyond the 10s default. */
export const maxDuration = 60;

export default async function ShortsPage({ searchParams }: { searchParams: Promise<{ business?: string }> }) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: businesses, error: businessError } = await supabase.from("businesses").select("id,name")
    .eq("owner_id", user.id).order("created_at");
  if (businessError) throw new Error("사업체 정보를 불러오지 못했습니다.", { cause: businessError });
  const selectedBusiness = businesses?.find((business) => business.id === query.business) ?? businesses?.[0];

  if (!selectedBusiness) return <div className="mx-auto max-w-6xl space-y-8"><PageHeading /><EmptyState mascot="point" title="먼저 사업체를 등록해주세요" description="사업 정보가 있어야 업종과 고객에 맞는 숏폼 대본과 장면을 만들 수 있어요." action={<Button asChild><Link href="/business">사업체 등록</Link></Button>} /></div>;

  const { data: template, error: templateError } = await supabase.from("automation_templates").select("id").eq("slug", "shorts").maybeSingle();
  if (templateError) throw new Error("숏폼 템플릿을 확인하지 못했습니다.", { cause: templateError });
  const { data: automation, error: automationError } = template
    ? await supabase.from("automations").select("*").eq("user_id", user.id).eq("business_id", selectedBusiness.id).eq("template_id", template.id).order("created_at").limit(1).maybeSingle()
    : { data: null, error: null };
  if (automationError) throw new Error("숏폼 설정을 불러오지 못했습니다.", { cause: automationError });

  const businessPicker = businesses && businesses.length > 1 ? <nav className="flex flex-wrap gap-2" aria-label="사업체 선택">{businesses.map((business) => <Button key={business.id} asChild size="sm" variant={business.id === selectedBusiness.id ? "default" : "outline"}><Link href={`/shorts?business=${business.id}`} aria-current={business.id === selectedBusiness.id ? "page" : undefined}>{business.name}</Link></Button>)}</nav> : null;
  if (!automation) return <div className="mx-auto max-w-6xl space-y-8"><PageHeading />{businessPicker}<EmptyState mascot="point" title={`${selectedBusiness.name}의 숏폼을 시작해보세요`} description="기본 예약 설정을 만든 뒤 바로 AI 영상 미리보기를 생성할 수 있어요." action={<ShortsCreateButton businessId={selectedBusiness.id} />} /></div>;

  const [runsResult, connectionsResult, inFlightResult] = await Promise.all([
    supabase.from("automation_runs").select("id,status,output,created_at").eq("automation_id", automation.id).order("created_at", { ascending: false }).limit(30),
    supabase.from("integration_connections").select("provider,status").eq("user_id", user.id).eq("business_id", selectedBusiness.id).in("provider", ["instagram", "youtube"]),
    supabase.from("automation_runs").select("id").eq("automation_id", automation.id).in("status", ["QUEUED", "RUNNING"]).limit(1).maybeSingle(),
  ]);
  if (runsResult.error || connectionsResult.error || inFlightResult.error) throw new Error("숏폼 작업 상태를 불러오지 못했습니다.");

  const safeRuns = (runsResult.data ?? []).filter((run) => run.status === "SUCCESS").map((run) => ({ ...run, safe: toSafeAutomationRunOutput(run.output) }));
  const previewRun = safeRuns.find((run) => {
    const raw = run.output && typeof run.output === "object" && !Array.isArray(run.output) ? run.output : null;
    return run.safe?.videoUrl && run.safe.script && raw?.operation !== "PUBLISH";
  });
  const latestPreview = previewRun?.safe?.videoUrl ? {
    runId: previewRun.id,
    createdAt: previewRun.created_at,
    videoUrl: previewRun.safe.videoUrl,
    hook: previewRun.safe.hook,
    topic: previewRun.safe.topic,
    caption: previewRun.safe.caption,
    script: previewRun.safe.script,
    scenes: previewRun.safe.scenes,
  } : null;
  const publications = safeRuns.flatMap((run) => (Object.entries(run.safe?.publicationResults ?? {}) as Array<[ShortsPublishPlatform, NonNullable<typeof run.safe>["publicationResults"][ShortsPublishPlatform]]>)
    .filter((entry): entry is [ShortsPublishPlatform, NonNullable<typeof entry[1]>] => Boolean(entry[1]))
    .map(([platform, result]) => ({ runId: run.id, createdAt: run.created_at, platform, ...result })));
  const connectionMap = Object.fromEntries((connectionsResult.data ?? []).map((item) => [item.provider, item.status])) as Partial<Record<ShortsPublishPlatform, string>>;
  const config = automation.config && typeof automation.config === "object" && !Array.isArray(automation.config) ? automation.config as Record<string, unknown> : {};
  const configuredPlatforms: ShortsPublishPlatform[] = Array.isArray(config.platforms) ? config.platforms.filter((item): item is ShortsPublishPlatform => item === "instagram" || item === "youtube") : [];
  const schedule = automation.schedule as unknown as AutomationSchedule;

  return <div className="mx-auto max-w-6xl space-y-8"><PageHeading />{businessPicker}<ShortsStudio automationId={automation.id} automationStatus={automation.status} schedule={schedule} configuredPlatforms={configuredPlatforms} connections={{ instagram: connectionMap.instagram ?? null, youtube: connectionMap.youtube ?? null }} latestPreview={latestPreview} publications={publications} hasInFlightRun={Boolean(inFlightResult.data)} nextRunAt={automation.next_run_at} /></div>;
}

function PageHeading() {
  return <PageHeader title="숏폼 스튜디오" description="AI 영상 생성부터 미리보기, Instagram과 YouTube 게시, 예약 운영까지 한곳에서 관리해요." />;
}

