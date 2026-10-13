import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { GuideNav } from "@/components/guide/guide-nav";
import { GuideShot } from "@/components/guide/guide-shot";
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

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 space-y-3">
      <h2 id={`${id}-title`} className="text-lg font-extrabold tracking-[-0.03em]">{title}</h2>
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
  const shotById = new Map(guide.shots.map((shot) => [shot.id, shot]));
  const related = guide.related.flatMap((slug) => getGuide(slug) ?? []);
  const sections = [
    { id: "what", label: "이 기능은 무엇인가요?" },
    { id: "prepare", label: "시작하기 전에" },
    { id: "enter", label: "들어가는 방법" },
    { id: "steps", label: "이렇게 사용해요" },
    { id: "inputs", label: "입력하는 정보와 예시" },
    { id: "buttons", label: "버튼과 옵션" },
    { id: "results", label: "받는 결과" },
    { id: "problems", label: "자주 나는 문제" },
    { id: "tips", label: "알아두면 좋아요" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <PageHeader
        back={{ href: "/guide", label: "이용방법 전체" }}
        title={guide.title}
        description={guide.summary}
        actions={<Badge variant={guide.free ? "success" : "secondary"}>{guide.free ? "무료" : "이용권 사용"}</Badge>}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        <aside className="min-w-0"><GuideNav current={guide.slug} sections={sections} /></aside>
        <article className="min-w-0 max-w-3xl space-y-10">
          <Block id="what" title="이 기능은 무엇인가요?">
            <p className="text-[15px] leading-7">{guide.what}</p>
            <p className="text-sm font-semibold text-muted-foreground">이런 분께 좋아요</p>
            <BulletList items={guide.whoFor} />
          </Block>

          <Block id="prepare" title="시작하기 전에 준비하세요"><BulletList items={guide.prepare} /></Block>

          <Block id="enter" title="들어가는 방법">
            <p className="text-[15px] leading-7">{guide.enter.how}</p>
            <Button asChild variant="outline" size="sm"><Link href={guide.enter.href}>‘{guide.enter.menu}’ 열기 <ArrowRight aria-hidden="true" /></Link></Button>
          </Block>

          <Block id="steps" title="이렇게 사용해요">
            <ol className="space-y-5">
              {guide.steps.map((step, index) => {
                const shot = step.shot ? shotById.get(step.shot) : undefined;
                return (
                  <li key={step.title} className="overflow-hidden rounded-2xl border bg-card">
                    <div className="flex gap-4 px-5 py-4 sm:px-6">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-extrabold text-primary" aria-hidden="true">{index + 1}</span>
                      <div className="min-w-0">
                        <h3 className="font-bold"><span className="sr-only">{index + 1}단계. </span>{step.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                    {shot ? <div className="border-t"><GuideShot slug={guide.slug} shot={shot} priority={index < 2} /></div> : null}
                  </li>
                );
              })}
            </ol>
          </Block>

          <Block id="inputs" title="입력하는 정보와 예시">
            <BulletList items={guide.inputs} />
            <p className="pt-1 text-sm font-semibold text-muted-foreground">예를 들면</p>
            <ul className="space-y-1.5 rounded-2xl bg-muted px-5 py-4 text-sm leading-6">
              {guide.examples.map((example) => <li key={example}>{example}</li>)}
            </ul>
          </Block>

          <Block id="buttons" title="버튼과 옵션">
            <dl className="divide-y overflow-hidden rounded-2xl border bg-card">
              {guide.buttons.map((button) => (
                <div key={button.name} className="grid gap-1 px-5 py-3.5 sm:grid-cols-[14rem_1fr] sm:gap-4">
                  <dt className="text-sm font-bold">{button.name}</dt>
                  <dd className="text-sm leading-6 text-muted-foreground">{button.description}</dd>
                </div>
              ))}
            </dl>
          </Block>

          <Block id="results" title="이런 결과를 받아요"><BulletList items={guide.results} /></Block>

          <Block id="problems" title="자주 나는 문제와 해결 방법">
            <ul className="space-y-3">
              {guide.problems.map((item) => (
                <li key={item.problem} className="rounded-2xl border bg-card px-5 py-4">
                  <p className="font-bold">{item.problem}</p>
                  <p className="mt-1.5 text-sm leading-6"><span className="font-semibold text-muted-foreground">왜 그럴까요? </span>{item.cause}</p>
                  <p className="mt-1 text-sm leading-6"><span className="font-semibold text-primary">이렇게 해보세요. </span>{item.fix}</p>
                </li>
              ))}
            </ul>
          </Block>

          <Block id="tips" title="알아두면 좋아요">
            <ul className="space-y-2 rounded-2xl bg-muted px-5 py-4 text-[15px] leading-7">
              {guide.tips.map((tip) => <li key={tip}>{tip}</li>)}
            </ul>
          </Block>

          {related.length > 0 ? (
            <section aria-labelledby="related-title" className="space-y-3">
              <h2 id="related-title" className="text-lg font-extrabold tracking-[-0.03em]">같이 보면 좋아요</h2>
              <ul className="flex flex-wrap gap-2">
                {related.map((item) => (
                  <li key={item.slug}><Link href={`/guide/${item.slug}`} className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3.5 py-2 text-sm font-semibold hover:bg-muted"><item.icon className="size-4 text-primary" aria-hidden="true" />{item.title}</Link></li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="flex flex-col gap-3 border-t pt-8 sm:flex-row sm:items-center sm:justify-between">
            <Button asChild size="lg"><Link href={guide.cta.href}>{guide.cta.label} <ArrowRight aria-hidden="true" /></Link></Button>
            <Link href="/guide" className="text-sm font-semibold text-primary hover:underline">다른 이용방법 보기</Link>
          </div>
        </article>
      </div>
    </div>
  );
}
