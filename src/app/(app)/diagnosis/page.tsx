import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { getReadinessScore } from "@/server/marketing/readiness";
import { ReadinessScoreCard } from "@/components/marketing/readiness-score-card";
import { getChannelNarrative, getLatestChannelDiagnosisSummary } from "@/server/channels";
import { ChannelDiagnosisCard } from "@/components/channels/channel-diagnosis-card";
import { AddChannelForm } from "@/components/channels/add-channel-form";
import { WebsiteDiagnosisCard, type StoredWebsiteDiagnosis } from "@/components/channels/website-diagnosis-card";
import { scoreItemsSchema } from "@/server/marketing/scoring";
import { isMissingSchemaError } from "@/server/shared/db-errors";
import { FormMessage } from "@/components/ui/form-message";
import type { BusinessSnsLinks } from "@/types/domain";

/** Readiness score, channel summary, and per-channel AI narratives are all fetched/generated here — give it room beyond the 10s default. */
export const maxDuration = 60;

export default async function DiagnosisPage({
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
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at");
  if (businessError) throw new Error("채널 진단에 필요한 사업체 정보를 불러오지 못했습니다.", { cause: businessError });

  const selectedBusiness = businesses?.find((business) => business.id === query.business) ?? businesses?.[0];
  if (!selectedBusiness) {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        <PageHeading />
        <EmptyState
          mascot="point"
          title="진단할 가게가 아직 없어요"
          description="업체명과 홈페이지 주소를 알려주시면 지금 마케팅이 얼마나 준비돼 있는지 점수로 알려드려요."
          action={<Button asChild><Link href="/onboarding">가게 정보 입력하기</Link></Button>}
        />
      </div>
    );
  }

  // A database that has not received the channel migrations yet must not take the whole page (and the homepage diagnosis) down.
  const [readiness, summaryResult, websiteResult] = await Promise.all([
    getReadinessScore(selectedBusiness, user.id),
    getLatestChannelDiagnosisSummary(selectedBusiness.id).then(
      (summary) => ({ summary, unavailable: false }),
      (error: unknown) => {
        if (!isMissingSchemaError(error)) throw error;
        return { summary: { businessId: selectedBusiness.id, channels: [], hasAnyData: false }, unavailable: true };
      },
    ),
    supabase
      .from("marketing_diagnoses")
      .select("score, score_breakdown, recommendations, content_status, source_url, created_at")
      .eq("business_id", selectedBusiness.id)
      .eq("source_type", "website")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const channelSummary = summaryResult.summary;
  const channelsUnavailable = summaryResult.unavailable;
  const breakdown = scoreItemsSchema.safeParse(websiteResult.data?.score_breakdown);
  const storedWebsite: StoredWebsiteDiagnosis | null = websiteResult.data
    ? {
        score: websiteResult.data.score,
        scoreBreakdown: breakdown.success ? breakdown.data : [],
        recommendations: websiteResult.data.recommendations ?? [],
        contentStatus: websiteResult.data.content_status,
        sourceUrl: websiteResult.data.source_url,
        createdAt: websiteResult.data.created_at,
      }
    : null;

  // Addresses the owner already put in the business info become one-click suggestions (unless that platform is already tracked).
  const snsLinks = (selectedBusiness.sns_links ?? {}) as BusinessSnsLinks;
  const trackedPlatforms = new Set<string>(channelSummary.channels.map((item) => item.channel));
  const channelSuggestions = [
    { platform: "youtube", label: "유튜브", url: snsLinks.youtube },
    { platform: "naver_blog", label: "네이버 블로그", url: snsLinks.naver_blog },
  ].flatMap((entry) => (entry.url?.trim() && !trackedPlatforms.has(entry.platform) ? [{ label: entry.label, url: entry.url.trim() }] : []));

  const narratives = await Promise.all(channelSummary.channels.map((item) => getChannelNarrative(item, selectedBusiness)));

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <PageHeading />

      {(businesses?.length ?? 0) > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label="진단할 사업체 선택">
          {businesses?.map((business) => (
            <Button key={business.id} asChild size="sm" variant={business.id === selectedBusiness.id ? "default" : "outline"}>
              <Link href={`/diagnosis?business=${business.id}`} aria-current={business.id === selectedBusiness.id ? "page" : undefined}>{business.name}</Link>
            </Button>
          ))}
        </nav>
      ) : null}

      <ReadinessScoreCard businessName={selectedBusiness.name} result={readiness} />

      <section aria-labelledby="website-diagnosis-title" className="space-y-5">
        <div>
          <h2 id="website-diagnosis-title" className="text-lg font-bold tracking-[-0.02em]">홈페이지 진단</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">홈페이지를 직접 열어보고 항목별 점수와 이유를 알려드려요.</p>
        </div>
        <WebsiteDiagnosisCard businessId={selectedBusiness.id} website={selectedBusiness.website} stored={storedWebsite} />
      </section>

      <section aria-labelledby="channel-diagnosis-title" className="space-y-5">
        <div>
          <h2 id="channel-diagnosis-title" className="text-lg font-bold tracking-[-0.02em]">채널 진단</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">유튜브·네이버 블로그·티스토리 채널의 활동성·꾸준함·콘텐츠 점수를 확인해요.</p>
        </div>

        {channelsUnavailable ? (
          <FormMessage variant="info">채널 진단 기능을 준비하는 중이에요. 서비스 관리자가 데이터베이스 업데이트를 마치면 바로 쓸 수 있어요. 홈페이지 진단은 지금도 쓸 수 있어요.</FormMessage>
        ) : (
          <AddChannelForm businessId={selectedBusiness.id} suggestions={channelSuggestions} />
        )}

        {channelsUnavailable ? null : channelSummary.hasAnyData ? (
          <div className="space-y-4">
            {channelSummary.channels.map((item, index) => (
              <ChannelDiagnosisCard key={item.channelId} item={item} narrative={narratives[index].narrative} businessId={selectedBusiness.id} />
            ))}
          </div>
        ) : (
          <EmptyState
            mascot="point"
            title="아직 진단된 채널이 없어요"
            description="위에서 채널 주소를 추가하면 바로 진단해드려요."
          />
        )}
      </section>
    </div>
  );
}

function PageHeading() {
  return (
    <PageHeader
      title="채널 진단"
      description="지금 마케팅이 얼마나 준비돼 있는지 점수로 확인하고, 먼저 채울 것을 알아보세요."
      actions={<Button asChild variant="outline"><Link href="/business"><Settings aria-hidden="true" /> 사업 정보 관리</Link></Button>}
    />
  );
}
