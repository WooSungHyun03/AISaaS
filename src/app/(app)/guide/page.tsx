import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { GUIDES } from "@/lib/guide-content";

export const metadata = { title: "이용방법" };

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader title="이용방법" description="처음이어도 괜찮아요. 하고 싶은 일을 골라 순서대로 따라오세요." />
      <ul className="grid gap-4 sm:grid-cols-2">
        {GUIDES.map((guide) => (
          <li key={guide.slug}>
            <Link href={`/guide/${guide.slug}`} className="group flex h-full flex-col rounded-2xl border bg-card p-6 transition-colors hover:border-primary/50 hover:bg-brand-soft/40">
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-primary"><guide.icon className="size-5" aria-hidden="true" /></span>
                <Badge variant={guide.free ? "success" : "secondary"}>{guide.free ? "무료" : "이용권 사용"}</Badge>
              </div>
              <h2 className="mt-5 text-lg font-extrabold tracking-[-0.03em]">{guide.title}</h2>
              <p className="mt-1.5 flex-1 text-[15px] leading-7 text-muted-foreground">{guide.summary}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">사용법 보기 <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" /></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
