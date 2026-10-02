"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TemplateRow } from "@/components/automations/template-card";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";
import type { AutomationTemplate } from "@/types/domain";

const CATEGORY_LABEL: Record<string, string> = { marketing: "마케팅", support: "고객 응대" };

export function MarketplaceCatalog({ templates }: { templates: AutomationTemplate[] }) {
  const [category, setCategory] = useState("all");
  const categories = Array.from(new Set(templates.map((template) => template.category)));
  const filtered = category === "all" ? templates : templates.filter((template) => template.category === category);
  const filters = [{ value: "all", label: "전체" }, ...categories.map((value) => ({ value, label: CATEGORY_LABEL[value] ?? value }))];

  return (
    <section aria-label="만들 수 있는 콘텐츠" className="space-y-5">
      {categories.length > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="종류별로 보기">
            {filters.map((filter) => {
              const selected = category === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setCategory(filter.value)}
                  aria-pressed={selected}
                  className={`min-h-10 cursor-pointer rounded-full border px-4 text-sm font-semibold transition-colors ${selected ? "border-ink bg-ink text-white" : "border-input bg-card text-muted-foreground hover:border-primary/50 hover:text-primary"}`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">{filtered.length}개</p>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <p className="font-bold">보여드릴 항목이 없어요</p>
          <p className="mt-2 text-[15px] text-muted-foreground">다른 종류를 선택해보세요.</p>
          {category !== "all" ? <Button variant="outline" onClick={() => setCategory("all")} className="mt-5">전체 보기</Button> : null}
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {filtered.map((template) => {
            const availability = AUTOMATION_AVAILABILITY[template.slug as keyof typeof AUTOMATION_AVAILABILITY] ?? "COMING_SOON";
            const canCreate = availability === "AVAILABLE" || availability === "BETA";
            return (
              <TemplateRow key={template.id} template={template}>
                {canCreate ? (
                  <Button asChild className="w-full" variant={availability === "AVAILABLE" ? "default" : "outline"}>
                    <Link href={`/automations/new?template=${encodeURIComponent(template.slug)}`}>
                      {availability === "BETA" ? "베타로 시작" : "시작하기"} <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                ) : (
                  <Button type="button" variant="outline" className="w-full" disabled aria-label={`${template.name} 준비 중`}>
                    준비 중이에요
                  </Button>
                )}
              </TemplateRow>
            );
          })}
        </ul>
      )}
    </section>
  );
}
