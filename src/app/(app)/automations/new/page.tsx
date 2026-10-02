import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AutomationForm } from "@/components/automations/automation-form";
import { BlogSetupWizard } from "@/components/automations/blog-setup-wizard";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/page-state";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";

export default async function NewAutomationPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [businessResult, templateResult] = await Promise.all([
    supabase.from("businesses").select("*").eq("owner_id", user.id).order("created_at", { ascending: true }),
    supabase.from("automation_templates").select("*").eq("is_active", true),
  ]);
  if (businessResult.error || templateResult.error) {
    throw new Error("콘텐츠 설정 정보를 불러오지 못했습니다.", { cause: businessResult.error ?? templateResult.error });
  }
  const businesses = businessResult.data;
  const allTemplates = templateResult.data;

  const availableTemplates = (allTemplates ?? []).filter((t) => {
    const availability = AUTOMATION_AVAILABILITY[t.slug as keyof typeof AUTOMATION_AVAILABILITY];
    return availability === "AVAILABLE" || availability === "BETA";
  });

  const defaultTemplateId = template ? availableTemplates.find((t) => t.slug === template)?.id : undefined;
  const selectedTemplate = availableTemplates.find((t) => t.id === defaultTemplateId) ?? availableTemplates[0];

  if (template && !defaultTemplateId) {
    return (
      <EmptyState mascot="point" title="이 콘텐츠는 아직 만들 수 없어요" description="지금 이용할 수 있는 콘텐츠 종류를 골라주세요." action={<Button asChild variant="outline"><Link href="/automations/marketplace">콘텐츠 종류 보기</Link></Button>} />
    );
  }

  if (availableTemplates.length === 0) {
    return (
      <EmptyState title="지금 만들 수 있는 콘텐츠가 없어요" description="새 콘텐츠가 열리면 ‘블로그·숏폼 시작’에서 바로 볼 수 있어요." action={<Button asChild variant="outline"><Link href="/automations/marketplace">돌아가기</Link></Button>} />
    );
  }

  if ((businesses ?? []).length === 0) {
    return (
      <EmptyState mascot="welcome" title="사업 정보를 먼저 알려주세요" description="내 사업에 맞는 글과 영상을 만들려면 기본 정보가 필요해요." action={<Button asChild><Link href="/onboarding">사업 정보 입력하기</Link></Button>} />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader back={{ href: "/automations/marketplace", label: "콘텐츠 종류" }} title="콘텐츠 만들기 설정" description="한 번 정해두면 정해진 때마다 새 콘텐츠를 만들어 드려요. 올리는 건 직접 해요." />
      {selectedTemplate.slug === "blog-marketing" ? (
        <BlogSetupWizard businesses={businesses ?? []} template={selectedTemplate} />
      ) : (
        <AutomationForm businesses={businesses ?? []} templates={availableTemplates} defaultTemplateId={defaultTemplateId} />
      )}
    </div>
  );
}
