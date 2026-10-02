import { createClient } from "@/lib/supabase/server";
import { MarketplaceCatalog } from "@/components/automations/marketplace-catalog";
import { PageHeader } from "@/components/layout/page-header";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";

export default async function MarketplacePage() {
  const supabase = await createClient();
  const { data: templates, error } = await supabase
    .from("automation_templates")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error("자동화 템플릿을 불러오지 못했습니다.", { cause: error });

  const order = Object.keys(AUTOMATION_AVAILABILITY);
  const sortedTemplates = (templates ?? []).sort((a, b) => {
    const aOrder = order.indexOf(a.slug);
    const bOrder = order.indexOf(b.slug);
    return (aOrder < 0 ? order.length : aOrder) - (bOrder < 0 ? order.length : bOrder);
  });

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="어떤 콘텐츠를 만들까요?"
        description="블로그 글과 숏폼 영상을 만들어드려요. 만든 콘텐츠는 확인하고 고친 뒤 직접 올리시면 돼요."
      />
      <MarketplaceCatalog templates={sortedTemplates} />
    </div>
  );
}
