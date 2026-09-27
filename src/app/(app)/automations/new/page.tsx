import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AutomationForm } from "@/components/automations/automation-form";
import { BlogSetupWizard } from "@/components/automations/blog-setup-wizard";
import { Button } from "@/components/ui/button";
import { Bot, Building2, Clock3 } from "lucide-react";
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
    throw new Error("자동화 설정 정보를 불러오지 못했습니다.", { cause: businessResult.error ?? templateResult.error });
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
      <EmptyState icon={<Clock3 className="size-5" />} title="이 자동화는 아직 생성할 수 없습니다" description="Marketplace에서 현재 사용 가능한 자동화를 선택해주세요." action={<Button asChild variant="outline"><Link href="/automations/marketplace">자동화 둘러보기</Link></Button>} />
    );
  }

  if (availableTemplates.length === 0) {
    return (
      <EmptyState icon={<Bot className="size-5" />} title="현재 생성할 수 있는 자동화가 없습니다" description="새로운 자동화가 공개되면 Marketplace에서 바로 확인할 수 있습니다." action={<Button asChild variant="outline"><Link href="/automations/marketplace">Marketplace로 돌아가기</Link></Button>} />
    );
  }

  if ((businesses ?? []).length === 0) {
    return (
      <EmptyState icon={<Building2 className="size-5" />} title="사업체 정보가 먼저 필요합니다" description="자동화가 내 사업에 맞는 결과를 만들 수 있도록 핵심 정보를 입력해주세요." action={<Button asChild><Link href="/onboarding">사업체 정보 입력하기</Link></Button>} />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">새 자동화 만들기</h1>
      {selectedTemplate.slug === "blog-marketing" ? (
        <BlogSetupWizard businesses={businesses ?? []} template={selectedTemplate} />
      ) : (
        <AutomationForm businesses={businesses ?? []} templates={availableTemplates} defaultTemplateId={defaultTemplateId} />
      )}
    </div>
  );
}
