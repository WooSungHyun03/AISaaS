import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { TemplateCard } from "@/components/automations/template-card";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";

export default async function MarketplacePage() {
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("automation_templates")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Automation Marketplace</h1>
        <p className="text-sm text-muted-foreground">원하는 업무 자동화를 선택하고 바로 설정을 시작하세요.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(templates ?? []).map((template) => {
          const availability = AUTOMATION_AVAILABILITY[template.slug as keyof typeof AUTOMATION_AVAILABILITY];
          const available = availability === "AVAILABLE" || availability === "BETA";
          return (
            <TemplateCard key={template.id} template={template}>
              {available ? (
                <Button asChild className="w-full">
                  <Link href={`/automations/new?template=${template.slug}`}>자동화 만들기</Link>
                </Button>
              ) : (
                <Button className="w-full" variant="outline" disabled>
                  준비중입니다
                </Button>
              )}
            </TemplateCard>
          );
        })}
      </div>
    </div>
  );
}
