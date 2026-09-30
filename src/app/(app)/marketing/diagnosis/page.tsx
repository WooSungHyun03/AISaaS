import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  CircleAlert,
  FileText,
  Globe2,
  Settings,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    .select("id, name, industry, description, location, target_customer, brand_tone, keywords, website")
    .eq("owner_id", user.id)
    .order("created_at");
  if (businessError) throw new Error("마케팅 진단에 필요한 사업체 정보를 불러오지 못했습니다.", { cause: businessError });

  const selectedBusiness = businesses?.find((business) => business.id === query.business) ?? businesses?.[0];
  if (!selectedBusiness) {
    return (
      <div className="mx-auto max-w-6xl space-y-8">
        <PageHeading />
        <EmptyState
          icon={<Building2 className="size-5" />}
          title="진단할 사업체가 없습니다"
          description="업체명과 홈페이지 주소를 등록하면 저장된 정보와 연결 상태를 기준으로 마케팅 준비도를 확인할 수 있습니다."
          action={<Button asChild><Link href="/onboarding">사업 정보 입력하기</Link></Button>}
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
  const scoreLabel = score >= 80 ? "운영 준비가 잘 되어 있어요" : score >= 50 ? "핵심 채널을 조금 더 채워보세요" : "기본 정보부터 차근차근 준비해보세요";
  const missingChannels = [
    !selectedBusiness.website ? "홈페이지 주소" : null,
    !hasInstagram ? "Instagram 연결" : null,
    activeAutomations.length === 0 ? "콘텐츠 자동화" : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeading />

      {(businesses?.length ?? 0) > 1 ? (
        <div className="flex flex-wrap gap-2" aria-label="진단할 사업체 선택">
          {businesses?.map((business) => (
            <Button key={business.id} asChild size="sm" variant={business.id === selectedBusiness.id ? "default" : "outline"}>
              <Link href={`/marketing/diagnosis?business=${business.id}`}>{business.name}</Link>
            </Button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.95fr)]">
        <Card className="border-blue-200 bg-blue-50/60 ring-0">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">현재 마케팅 점수</CardTitle>
              <Badge variant="outline" className="border-blue-200 bg-white text-blue-700">{selectedBusiness.name}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-5xl font-bold tracking-tight text-slate-950">{score}<span className="ml-1 text-base font-medium text-slate-500">/ 100</span></p>
            <Progress value={score} className="mt-5" aria-label={`마케팅 준비도 ${score}점`} />
            <p className="mt-4 text-sm font-medium text-slate-800">{scoreLabel}</p>
            <p className="mt-2 text-xs leading-5 text-slate-600">저장한 사업 정보, 홈페이지 등록, 외부 채널 연결, 최근 30일 자동화 실행을 기준으로 계산합니다.</p>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-3">
          <DiagnosisCard
            icon={<Globe2 className="size-5" />}
            title="채널 준비도"
            value={missingChannels.length ? `${missingChannels.length}개 보완 필요` : "핵심 채널 준비 완료"}
            description={missingChannels.length ? missingChannels.join(" · ") : "홈페이지와 SNS 연결을 확인했습니다."}
            ready={missingChannels.length === 0}
          />
          <DiagnosisCard
            icon={<FileText className="size-5" />}
            title="콘텐츠 운영"
            value={activeAutomations.length ? `활성 자동화 ${activeAutomations.length}개` : "운영 자동화 없음"}
            description={recentSuccesses ? `최근 30일 성공 실행 ${recentSuccesses}회` : "최근 30일 성공 실행이 없습니다."}
            ready={activeAutomations.length > 0 && recentSuccesses > 0}
          />
          <DiagnosisCard
            icon={<Camera className="size-5" />}
            title="SNS 활성도"
            value={hasInstagram ? "Instagram 연결됨" : "Instagram 미연결"}
            description={hasInstagram ? instagram?.account_identifier ?? "연결된 Professional 계정" : "계정을 연결하면 게시 자동화를 사용할 수 있습니다."}
            ready={hasInstagram}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Activity className="size-4 text-blue-700" /> 진단 기준과 다음 할 일</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            <ReadinessRow label="사업 정보" ready={completedProfileFields >= 4} detail={`${completedProfileFields}/${profileFields.length}개 항목 입력`} href="/business" />
            <ReadinessRow label="홈페이지" ready={Boolean(selectedBusiness.website)} detail={selectedBusiness.website ?? "등록된 주소 없음"} href="/business" />
            <ReadinessRow label="Instagram" ready={hasInstagram} detail={hasInstagram ? "연결 상태 정상" : "외부 서비스 연결 필요"} href={`/settings?business=${selectedBusiness.id}`} />
            <ReadinessRow label="콘텐츠 일정" ready={activeAutomations.length > 0} detail={activeAutomations.length ? `${activeAutomations.length}개 활성 일정` : "활성 일정 없음"} href="/automations/marketplace" />
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex items-start gap-3">
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold text-slate-950">주소 분석 범위 안내</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">현재 버전은 저장된 홈페이지 주소와 연결 상태를 진단에 반영합니다. 외부 페이지의 본문을 읽어 사업 정보를 자동으로 채우는 기능은 준비 중입니다.</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline" className="bg-white"><Link href="/business"><Building2 className="size-4" /> 정보 직접 수정</Link></Button>
              <Button asChild size="sm" className="bg-blue-600 text-white hover:bg-blue-700"><Link href="/marketing/calendar"><CalendarDays className="size-4" /> 캘린더 보기</Link></Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PageHeading() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-700">Free marketing check</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">마케팅 진단</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">현재 등록된 사업 정보와 채널 연결, 콘텐츠 운영 상태를 한눈에 확인하세요.</p>
      </div>
      <Button asChild variant="outline"><Link href="/business"><Settings className="size-4" /> 사업 정보 관리</Link></Button>
    </div>
  );
}

function DiagnosisCard({ icon, title, value, description, ready }: { icon: React.ReactNode; title: string; value: string; description: string; ready: boolean }) {
  return (
    <Card className="ring-0">
      <CardContent className="space-y-4 pt-6">
        <span className={`flex size-10 items-center justify-center rounded-xl ${ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{icon}</span>
        <div>
          <p className="text-xs font-medium text-slate-500">{title}</p>
          <p className="mt-1 font-semibold text-slate-950">{value}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ReadinessRow({ label, ready, detail, href }: { label: string; ready: boolean; detail: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/40">
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
        {ready ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        <span className="block truncate text-xs text-slate-500">{detail}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-slate-400" />
    </Link>
  );
}
