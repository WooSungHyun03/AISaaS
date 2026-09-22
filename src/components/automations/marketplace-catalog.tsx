"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateCard } from "@/components/automations/template-card";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";
import type { AutomationTemplate } from "@/types/domain";

const CATEGORY_LABEL: Record<string, string> = { marketing: "마케팅", support: "고객 응대" };

export function MarketplaceCatalog({ templates }: { templates: AutomationTemplate[] }) {
  const [category, setCategory] = useState("all");
  const categories = Array.from(new Set(templates.map((template) => template.category)));
  const filtered = category === "all" ? templates : templates.filter((template) => template.category === category);

  return (
    <section aria-label="자동화 목록" className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-slate-500"><SlidersHorizontal className="size-3.5" /> 목적별 보기</p>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="자동화 카테고리 필터">
            {[{ value: "all", label: "전체" }, ...categories.map((value) => ({ value, label: CATEGORY_LABEL[value] ?? value }))].map((filter) => {
              const count = filter.value === "all" ? templates.length : templates.filter((template) => template.category === filter.value).length;
              const selected = category === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setCategory(filter.value)}
                  aria-pressed={selected}
                  className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"}`}
                >
                  {filter.label} <span className={selected ? "text-blue-100" : "text-slate-400"}>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-sm text-slate-500" aria-live="polite">{filtered.length}개의 자동화</p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <p className="font-medium text-slate-800">표시할 자동화가 없습니다</p>
          <p className="mt-2 text-sm text-slate-500">다른 카테고리를 선택하거나 템플릿 등록 상태를 확인해주세요.</p>
          {category !== "all" ? <Button variant="outline" onClick={() => setCategory("all")} className="mt-5">전체 보기</Button> : null}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template) => {
            const availability = AUTOMATION_AVAILABILITY[template.slug as keyof typeof AUTOMATION_AVAILABILITY] ?? "COMING_SOON";
            const canCreate = availability === "AVAILABLE" || availability === "BETA";
            return (
              <TemplateCard key={template.id} template={template}>
                {canCreate ? (
                  <Button asChild className="h-10 w-full bg-blue-600 text-white hover:bg-blue-700">
                    <Link href={`/automations/new?template=${encodeURIComponent(template.slug)}`}>
                      {availability === "BETA" ? "베타로 시작하기" : "자동화 만들기"} <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                ) : (
                  <Button type="button" variant="outline" className="h-10 w-full" disabled aria-label={`${template.name} 준비 중`}>
                    준비 중
                  </Button>
                )}
              </TemplateCard>
            );
          })}
        </div>
      )}
    </section>
  );
}
