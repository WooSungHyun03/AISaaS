import { createClient } from "@/lib/supabase/server";
import { listPublishedFaqs } from "@/server/customer-support/faq";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const GUIDES = [
  {
    title: "블로그 마케팅 자동화 시작하기",
    description: "사업체 프로필을 등록하고 블로그 자동화를 켜는 방법을 안내합니다.",
  },
  {
    title: "브랜드 톤 설정 가이드",
    description: "AI가 생성하는 콘텐츠의 말투와 분위기를 사업에 맞게 설정하는 방법입니다.",
  },
  {
    title: "자동화 실행 주기 이해하기",
    description: "월/수/금 등 반복 주기를 설정하면 다음 실행 시각이 어떻게 계산되는지 설명합니다.",
  },
];

export default async function GuidesPage() {
  const supabase = await createClient();
  const faqs = await listPublishedFaqs(supabase);

  return (
    <div className="mx-auto max-w-4xl space-y-16 px-4 py-16">
      <section className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">자동화 가이드</h1>
          <p className="text-muted-foreground">자동화를 처음 시작하는 분들을 위한 안내입니다.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {GUIDES.map((guide) => (
            <Card key={guide.title}>
              <CardHeader>
                <CardTitle className="text-base">{guide.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{guide.description}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">자주 묻는 질문</h2>
        {faqs.length > 0 ? (
          <Accordion type="single" collapsible>
            {faqs.map((faq) => (
              <AccordionItem key={faq.id} value={faq.id}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <p className="text-sm text-muted-foreground">등록된 FAQ가 아직 없습니다.</p>
        )}
      </section>
    </div>
  );
}
