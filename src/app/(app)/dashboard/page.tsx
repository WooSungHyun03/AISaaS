import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import {
  CalendarSummarySection,
  CreditsSection,
  DashboardSectionSkeleton,
  DiagnosisSummarySection,
  GrowthSummarySection,
  NextActionSection,
  RecentContentSection,
  RecentUsageSection,
} from "@/components/dashboard/dashboard-sections";
import { getGrowthSummary, getLatestChannelDiagnosisSummary } from "@/server/channels";
import { ensureTrialCredits } from "@/server/billing/credits";
import {
  buildDashboardNextAction,
  getDashboardCalendar,
  getDashboardCredits,
  getDashboardIdentity,
  getDashboardProgress,
  getDashboardRecentContent,
  getDashboardRecentUsage,
} from "@/server/dashboard/overview";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Layout and page rendering can overlap. The RPC is idempotent, so the
  // dashboard may safely ensure the first-entry grant before reading it.
  await ensureTrialCredits(user.id).catch(() => false);
  const identity = await getDashboardIdentity(user.id);
  const businessId = identity.business?.id ?? null;

  // Start every independent read before rendering the section components.
  // Each section awaits only its own promise under a separate Suspense boundary.
  const diagnosisPromise = businessId
    ? getLatestChannelDiagnosisSummary(businessId)
    : Promise.resolve(null);
  const growthPromise = businessId
    ? getGrowthSummary(businessId)
    : Promise.resolve(null);
  const calendarPromise = getDashboardCalendar(user.id);
  const contentPromise = businessId
    ? getDashboardRecentContent(businessId)
    : Promise.resolve(null);
  const progressPromise = businessId
    ? getDashboardProgress(businessId, user.id)
    : Promise.resolve({ channelCount: 0, calendarCount: 0, contentCount: 0 });
  const creditsPromise = getDashboardCredits(user.id);
  const usagePromise = getDashboardRecentUsage();
  const actionPromise = Promise.all([progressPromise, diagnosisPromise]).then(([progress, diagnosis]) =>
    buildDashboardNextAction({
      hasBusiness: Boolean(businessId),
      channelCount: progress.channelCount,
      hasDiagnosis: diagnosis?.hasAnyData ?? false,
      calendarCount: progress.calendarCount,
      contentCount: progress.contentCount,
    }),
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        title={identity.displayName ? `${identity.displayName}님, 안녕하세요` : "안녕하세요"}
        description={identity.business ? `${identity.business.name}의 마케팅 현황과 다음 할 일을 한눈에 확인하세요.` : "마케팅 현황과 다음 할 일을 한눈에 확인하세요."}
      />

      <Suspense fallback={<DashboardSectionSkeleton className="min-h-48" />}>
        <NextActionSection actionPromise={actionPromise} />
      </Suspense>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        <Suspense fallback={<DashboardSectionSkeleton />}>
          <DiagnosisSummarySection diagnosisPromise={diagnosisPromise} />
        </Suspense>
        <Suspense fallback={<DashboardSectionSkeleton />}>
          <CreditsSection creditsPromise={creditsPromise} />
        </Suspense>

        <Suspense fallback={<DashboardSectionSkeleton />}>
          <CalendarSummarySection calendarPromise={calendarPromise} />
        </Suspense>
        <Suspense fallback={<DashboardSectionSkeleton />}>
          <RecentContentSection contentPromise={contentPromise} />
        </Suspense>

        <Suspense fallback={<DashboardSectionSkeleton />}>
          <RecentUsageSection usagePromise={usagePromise} />
        </Suspense>
        <Suspense fallback={<DashboardSectionSkeleton />}>
          <GrowthSummarySection growthPromise={growthPromise} />
        </Suspense>
      </div>
    </div>
  );
}
