import Link from "next/link";
import { GUIDES, type GuideSlug } from "@/lib/guide-content";
import { cn } from "@/lib/utils";

/** 기능 목차. 넓은 화면에서는 왼쪽에 고정되고, 휴대폰에서는 가로로 넘겨 고르는 버튼 줄이에요. */
export function GuideNav({ current, sections }: { current?: GuideSlug; sections?: Array<{ id: string; label: string }> }) {
  return (
    <nav aria-label="이용방법 목차" className="space-y-5 lg:sticky lg:top-6">
      <div>
        <p className="mb-2 hidden text-xs font-bold tracking-wide text-muted-foreground lg:block">기능 고르기</p>
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
          {GUIDES.map((guide, index) => {
            const active = guide.slug === current;
            return (
              <li key={guide.slug} className="shrink-0">
                <Link
                  href={`/guide/${guide.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors lg:rounded-xl lg:border-transparent lg:px-3 lg:py-2.5",
                    active ? "border-primary bg-brand-soft text-primary" : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="hidden size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-extrabold lg:flex" aria-hidden="true">{index + 1}</span>
                  <guide.icon className="size-4 shrink-0 lg:hidden" aria-hidden="true" />
                  <span className="whitespace-nowrap">{guide.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {sections && sections.length > 0 ? (
        <div className="hidden lg:block">
          <p className="mb-2 text-xs font-bold tracking-wide text-muted-foreground">이 페이지에서</p>
          <ul className="space-y-0.5 border-l pl-3">
            {sections.map((section) => (
              <li key={section.id}><a href={`#${section.id}`} className="block rounded py-1 text-sm text-muted-foreground hover:text-foreground">{section.label}</a></li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}
