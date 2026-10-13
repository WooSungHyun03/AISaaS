import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { GUIDES } from "@/lib/guide-content";

export const metadata = { title: "이용방법" };

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader title="이용방법" description="처음이어도 괜찮아요. 알고 싶은 기능을 골라 화면을 보며 순서대로 따라오세요." />
      <section aria-labelledby="guide-list-title" className="space-y-4">
        <h2 id="guide-list-title" className="sr-only">기능별 이용방법 목차</h2>
        <ol className="grid gap-4 sm:grid-cols-2">
          {GUIDES.map((guide, index) => (
            <li key={guide.slug}>
              <Link href={`/guide/${guide.slug}`} className="group flex h-full flex-col rounded-2xl border bg-card p-6 transition-colors hover:border-primary/50 hover:bg-brand-soft/40">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-primary"><guide.icon className="size-5" aria-hidden="true" /></span>
                  <div className="flex items-center gap-2">
                    <Badge variant={guide.free ? "success" : "secondary"}>{guide.free ? "무료" : "이용권 사용"}</Badge>
                    <span className="text-sm font-extrabold text-muted-foreground" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  </div>
                </div>
                <h3 className="mt-5 text-lg font-extrabold tracking-[-0.03em]">{guide.title}</h3>
                <p className="mt-1.5 flex-1 text-[15px] leading-7 text-muted-foreground">{guide.summary}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">사용법 보기 <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" /></span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
