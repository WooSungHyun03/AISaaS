import { createClient } from "@/lib/supabase/server";
import { MarketplaceCatalog } from "@/components/automations/marketplace-catalog";
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
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-blue-700">Automations</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Automation Marketplace</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">반복되는 업무에 맞는 자동화를 살펴보세요. 각 카드에서 지금 설정할 수 있는 기능과 준비 중인 기능을 구분할 수 있습니다.</p>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs text-blue-900">
        <span><strong>Available</strong> · 지금 설정 가능</span>
        <span><strong>Beta</strong> · 시험 제공</span>
        <span><strong>Coming Soon</strong> · 준비 중, 생성 불가</span>
      </div>
      <MarketplaceCatalog templates={sortedTemplates} />
    </div>
  );
}
