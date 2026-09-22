import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AutomationForm } from "@/components/automations/automation-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

  const [{ data: businesses }, { data: allTemplates }] = await Promise.all([
    supabase.from("businesses").select("*").eq("owner_id", user.id).order("created_at", { ascending: true }),
    supabase.from("automation_templates").select("*").eq("is_active", true),
  ]);

  const availableTemplates = (allTemplates ?? []).filter((t) => {
    const availability = AUTOMATION_AVAILABILITY[t.slug as keyof typeof AUTOMATION_AVAILABILITY];
    return availability === "AVAILABLE" || availability === "BETA";
  });

  const defaultTemplateId = template ? availableTemplates.find((t) => t.slug === template)?.id : undefined;

  if (template && !defaultTemplateId) {
    return (
      <Card>
        <CardContent className="space-y-4 py-12 text-center">
          <p className="font-medium">이 자동화는 아직 생성할 수 없습니다.</p>
          <p className="text-sm text-muted-foreground">Marketplace에서 현재 사용 가능한 자동화를 선택해주세요.</p>
          <Button asChild variant="outline"><Link href="/automations/marketplace">자동화 둘러보기</Link></Button>
        </CardContent>
      </Card>
    );
  }

  if (availableTemplates.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">현재 생성할 수 있는 자동화가 없습니다.</p>
          <Button asChild variant="outline"><Link href="/automations/marketplace">Marketplace로 돌아가기</Link></Button>
        </CardContent>
      </Card>
    );
  }

  if ((businesses ?? []).length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <p className="text-sm text-muted-foreground">자동화를 만들려면 먼저 사업체를 등록해주세요.</p>
          <Button asChild>
            <Link href="/onboarding">사업체 정보 입력하기</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">새 자동화 만들기</h1>
      <AutomationForm businesses={businesses ?? []} templates={availableTemplates} defaultTemplateId={defaultTemplateId} />
    </div>
  );
}
