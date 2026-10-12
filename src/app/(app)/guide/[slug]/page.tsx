import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GUIDES, getGuide } from "@/lib/guide-content";

export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const guide = getGuide((await params).slug);
  return { title: guide ? `${guide.title} 이용방법` : "이용방법" };
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-extrabold tracking-[-0.03em]">{title}</h2>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-[15px] leading-7">
      {items.map((item) => (
        <li key={item} className="flex gap-2.5"><span className="mt-3 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />{item}</li>
      ))}
    </ul>
  );
}

export default async function GuideDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = getGuide((await params).slug);
  if (!guide) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-10 pb-10">
      <PageHeader
        back={{ href: "/guide", label: "이용방법" }}
        title={guide.title}
        description={guide.summary}
        actions={<Badge variant={guide.free ? "success" : "secondary"}>{guide.free ? "무료" : "이용권 사용"}</Badge>}
      />

      <Block title="이 기능은 무엇인가요?">
        <p className="text-[15px] leading-7">{guide.what}</p>
      </Block>

      <Block title="이런 분께 좋아요"><BulletList items={guide.whoFor} /></Block>
      <Block title="시작하기 전에 준비하세요"><BulletList items={guide.prepare} /></Block>

      <Block title="이렇게 사용해요">
        <ol className="divide-y overflow-hidden rounded-2xl border bg-card">
          {guide.steps.map((step, index) => (
            <li key={step.title} className="flex gap-4 px-5 py-4 sm:px-6">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-extrabold text-primary" aria-hidden="true">{index + 1}</span>
              <div className="min-w-0">
                <h3 className="font-bold"><span className="sr-only">{index + 1}단계. </span>{step.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </Block>

      <Block title="입력하는 정보"><BulletList items={guide.inputs} /></Block>
      <Block title="이런 결과를 받아요"><BulletList items={guide.results} /></Block>
      <Block title="알아두면 좋아요">
        <ul className="space-y-2 rounded-2xl bg-muted px-5 py-4 text-[15px] leading-7">
          {guide.tips.map((tip) => <li key={tip}>{tip}</li>)}
        </ul>
      </Block>

      <div className="flex flex-col gap-3 border-t pt-8 sm:flex-row sm:items-center sm:justify-between">
        <Button asChild size="lg"><Link href={guide.cta.href}>{guide.cta.label} <ArrowRight aria-hidden="true" /></Link></Button>
        <Link href="/guide" className="text-sm font-semibold text-primary hover:underline">다른 이용방법 보기</Link>
      </div>
    </div>
  );
}
