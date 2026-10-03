import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarDays, Check, CircleAlert, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Mascot } from "@/components/brand/mascot";
import { PageHeader } from "@/components/layout/page-header";
import { DiagnosisForm } from "@/components/marketing/diagnosis-form";
import { ScoreRing, scoreTone } from "@/components/marketing/score-ring";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/page-state";

function isInstagramConnected(status: string | undefined) {
  return status === "CONNECTED";
}

export default async function MarketingDiagnosisPage({
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
  if (businessError) throw new Error("마케팅 진단에 필요한 사업체 정보를 불러오지 못했습니다.", { cause: businessError });

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

  const [{ data: connections, error: connectionError }, { data: automations, error: automationError }] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("provider, status, account_identifier")
      .eq("user_id", user.id)
      .eq("business_id", selectedBusiness.id)
      .neq("status", "DISCONNECTED"),
    supabase
      .from("automations")
      .select("id, name, status, template_id, last_run_at, next_run_at")
      .eq("user_id", user.id)
      .eq("business_id", selectedBusiness.id),
  ]);
  const readError = connectionError || automationError;
  if (readError) throw new Error("마케팅 채널 상태를 불러오지 못했습니다.", { cause: readError });

  const automationIds = (automations ?? []).map((automation) => automation.id);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
  const recentSuccessResult = automationIds.length
    ? await supabase
      .from("automation_runs")
      .select("id", { count: "exact", head: true })
      .in("automation_id", automationIds)
      .eq("status", "SUCCESS")
      .gte("created_at", thirtyDaysAgo.toISOString())
    : { count: 0, error: null };
  if (recentSuccessResult.error) throw new Error("최근 콘텐츠 운영 기록을 불러오지 못했습니다.", { cause: recentSuccessResult.error });

  const instagram = connections?.find((connection) => connection.provider === "instagram");
  const hasInstagram = isInstagramConnected(instagram?.status);
  const activeAutomations = (automations ?? []).filter((automation) => automation.status === "ACTIVE");
  const recentSuccesses = recentSuccessResult.count ?? 0;
  const profileFields = [
    selectedBusiness.industry,
    selectedBusiness.description,
    selectedBusiness.location,
    selectedBusiness.target_customer,
    selectedBusiness.brand_tone,
    selectedBusiness.keywords.length ? "keywords" : null,
  ];
  const completedProfileFields = profileFields.filter(Boolean).length;
  const profileScore = Math.round((completedProfileFields / profileFields.length) * 30);
  const score = profileScore
    + (selectedBusiness.website ? 20 : 0)
    + (hasInstagram ? 20 : 0)
    + (activeAutomations.length ? 15 : 0)
    + (recentSuccesses ? 15 : 0);
  const tone = scoreTone(score);

  const rows = [
    { label: "사업 정보", ready: completedProfileFields >= 4, detail: `${completedProfileFields}/${profileFields.length}개 항목을 입력했어요`, href: "/business", cta: "정보 채우기", todo: "사업 정보를 더 채우는 것", points: profileScore, max: 30 },
    { label: "홈페이지", ready: Boolean(selectedBusiness.website), detail: selectedBusiness.website ?? "등록된 주소가 없어요", href: "/business", cta: "주소 등록", todo: "홈페이지 주소를 등록하는 것", points: selectedBusiness.website ? 20 : 0, max: 20 },
    { label: "Instagram", ready: hasInstagram, detail: hasInstagram ? (instagram?.account_identifier ?? "계정이 연결돼 있어요") : "연결된 계정이 없어요", href: `/settings?business=${selectedBusiness.id}`, cta: "계정 연결", todo: "Instagram 계정을 연결하는 것", points: hasInstagram ? 20 : 0, max: 20 },
    { label: "콘텐츠 만들기 설정", ready: activeAutomations.length > 0, detail: activeAutomations.length ? `진행 중인 설정 ${activeAutomations.length}개` : "켜 둔 설정이 없어요", href: "/automations/marketplace", cta: "설정하기", todo: "콘텐츠 만들기를 설정하는 것", points: activeAutomations.length ? 15 : 0, max: 15 },
    { label: "최근 30일 제작", ready: recentSuccesses > 0, detail: recentSuccesses ? `콘텐츠 ${recentSuccesses}개를 만들었어요` : "만든 콘텐츠가 아직 없어요", href: "/automations/marketplace", cta: "만들어보기", todo: "첫 콘텐츠를 만들어보는 것", points: recentSuccesses ? 15 : 0, max: 15 },
  ];
  const nextTodo = rows.find((row) => !row.ready);

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <PageHeading />

      {(businesses?.length ?? 0) > 1 ? (
        <nav className="flex flex-wrap gap-2" aria-label="진단할 사업체 선택">
          {businesses?.map((business) => (
            <Button key={business.id} asChild size="sm" variant={business.id === selectedBusiness.id ? "default" : "outline"}>
              <Link href={`/marketing/diagnosis?business=${business.id}`} aria-current={business.id === selectedBusiness.id ? "page" : undefined}>{business.name}</Link>
            </Button>
          ))}
        </nav>
      ) : null}

      <section aria-labelledby="score-title" className="relative overflow-hidden rounded-2xl bg-brand-soft">
        <div className="grid items-center gap-8 px-6 py-8 sm:px-10 md:grid-cols-[auto_minmax(0,1fr)_auto]">
          <ScoreRing score={score} size={164} className="mx-auto md:mx-0" />
          <div className="text-center md:text-left">
            <p className="text-sm font-semibold text-muted-foreground">{selectedBusiness.name}의 마케팅 점수</p>
            <h2 id="score-title" className="mt-1 text-2xl font-extrabold tracking-[-0.04em] sm:text-[1.75rem]">{tone.label}</h2>
            <p className="mt-3 max-w-md text-[15px] leading-7 text-muted-foreground">
              {nextTodo
                ? `가장 먼저 해볼 일은 ${nextTodo.todo}이에요. 여기부터 하면 점수가 가장 빨리 올라요.`
                : "핵심 항목이 모두 채워졌어요. 이제 캘린더의 계획대로 콘텐츠를 만들어보세요."}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 md:justify-start">
              {nextTodo ? <Button asChild><Link href={nextTodo.href}>{nextTodo.cta} <ArrowRight aria-hidden="true" /></Link></Button> : null}
              <Button asChild variant={nextTodo ? "outline" : "default"}><Link href="/calendar"><CalendarDays aria-hidden="true" /> 마케팅 캘린더 보기</Link></Button>
            </div>
          </div>
          <Mascot pose={score >= 80 ? "thumbsUp" : "point"} size={170} className="hidden w-[150px] md:block lg:w-[170px]" />
        </div>
      </section>

      <section aria-labelledby="breakdown-title">
        <h2 id="breakdown-title" className="text-lg font-bold tracking-[-0.02em]">점수는 이렇게 계산했어요</h2>
        <p className="mt-1 text-[15px] text-muted-foreground">저장된 사업 정보와 연결 상태, 최근 30일 제작 기록을 기준으로 해요.</p>
        <ul className="mt-5 divide-y divide-border border-y border-border">
          {rows.map((row) => (
            <li key={row.label} className="grid items-center gap-x-6 gap-y-2 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
              <div className="flex min-w-0 items-start gap-3">
                <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${row.ready ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
                  {row.ready ? <Check className="size-3.5" strokeWidth={3} aria-label="준비됨" /> : <CircleAlert className="size-3.5" strokeWidth={3} aria-label="보완 필요" />}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{row.label}</p>
                  <p className="truncate text-sm text-muted-foreground">{row.detail}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Progress value={(row.points / row.max) * 100} className="h-1.5" aria-label={`${row.label} ${row.max}점 중 ${row.points}점`} />
                <span className="tabular w-12 shrink-0 text-right text-sm font-bold">{row.points}<span className="font-medium text-muted-foreground">/{row.max}</span></span>
              </div>
              <div className="md:text-right">
                {row.ready ? null : <Link href={row.href} className="text-sm font-semibold text-primary hover:underline">{row.cta} →</Link>}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex items-start gap-2 text-[13px] leading-6 text-muted-foreground">
          <CircleAlert className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
          이 점수는 저장된 사업 정보와 연결 상태, 최근 제작 기록을 기준으로 계산해요. 아래에서 홈페이지 주소로 더 자세한 AI 진단을 받아보세요.
        </p>
      </section>

      <section aria-labelledby="url-diagnosis-title" className="space-y-4">
        <div>
          <h2 id="url-diagnosis-title" className="text-lg font-bold tracking-[-0.02em]">홈페이지로 더 자세히 진단하기</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">홈페이지 주소를 입력하면 AI가 내용을 읽고 점수와 추천 액션을 알려드려요. 결과에서 Business Profile을 바로 채울 수도 있어요.</p>
        </div>
        <DiagnosisForm business={selectedBusiness} />
      </section>
    </div>
  );
}

function PageHeading() {
  return (
    <PageHeader
      title="마케팅 진단"
      description="지금 마케팅이 얼마나 준비돼 있는지 점수로 확인하고, 먼저 채울 것을 알아보세요."
      actions={<Button asChild variant="outline"><Link href="/business"><Settings aria-hidden="true" /> 사업 정보 관리</Link></Button>}
    />
  );
}
