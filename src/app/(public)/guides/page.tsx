import { createClient } from "@/lib/supabase/server";
import { listPublishedFaqs } from "@/server/customer-support/faq";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export const metadata = { title: "활용 가이드" };

const GUIDES = [
  { step: "1", title: "마케팅 진단으로 시작하기", description: "사업 정보를 넣으면 홈페이지·SNS 상태를 점수로 보고, 먼저 채울 곳을 알려드려요." },
  { step: "2", title: "마케팅 캘린더 활용하기", description: "진단 결과로 2~4주 콘텐츠 계획을 만들고, 오늘 올릴 콘텐츠를 바로 만들어요." },
  { step: "3", title: "블로그 글·숏폼 만들기", description: "키워드와 말투를 정해두면 글 초안과 숏폼 대본을 만들어요. 올리는 건 직접 해요." },
];

export default async function GuidesPage() {
  const supabase = await createClient();
  const faqs = await listPublishedFaqs(supabase);

  return (
    <div className="mx-auto max-w-4xl space-y-14 px-4 py-12 sm:px-6 sm:py-16">
      <section aria-labelledby="guides-title" className="space-y-8">
        <header className="max-w-2xl">
          <h1 id="guides-title" className="text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">활용 가이드</h1>
          <p className="mt-3 text-[15px] leading-7 text-muted-foreground">처음이어도 괜찮아요. 세 단계만 따라오면 첫 콘텐츠까지 만들 수 있어요.</p>
        </header>
        <ol className="divide-y overflow-hidden rounded-2xl border bg-card">
          {GUIDES.map((guide) => (
            <li key={guide.title} className="flex gap-4 px-5 py-5 sm:gap-5 sm:px-6">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-extrabold text-primary" aria-hidden="true">{guide.step}</span>
              <div><h2 className="font-bold">{guide.title}</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">{guide.description}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="faq-title" className="space-y-4">
        <h2 id="faq-title" className="text-2xl font-extrabold tracking-[-0.03em]">자주 묻는 질문</h2>
        {faqs.length > 0 ? (
          <Accordion type="single" collapsible className="rounded-2xl border bg-card px-5 sm:px-6">
            {faqs.map((faq) => (
              <AccordionItem key={faq.id} value={faq.id}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <p className="rounded-2xl bg-muted px-5 py-6 text-[15px] text-muted-foreground">아직 등록된 질문이 없어요. 궁금한 점은 언제든 문의해주세요.</p>
        )}
      </section>
    </div>
  );
}
