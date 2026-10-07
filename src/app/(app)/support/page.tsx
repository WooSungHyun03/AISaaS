import { MessageCircleQuestion } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listPublishedFaqs } from "@/server/customer-support/faq";
import { PageHeader } from "@/components/layout/page-header";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { EmptyState } from "@/components/ui/page-state";

export const metadata = { title: "문의" };

export default async function SupportPage() {
  const supabase = await createClient();
  const faqs = await listPublishedFaqs(supabase);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="문의"
        description="자주 묻는 질문에서 필요한 답을 빠르게 확인해보세요."
      />

      <section aria-labelledby="support-faq-title" className="space-y-4">
        <h2 id="support-faq-title" className="text-lg font-extrabold tracking-[-0.03em]">자주 묻는 질문</h2>
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
          <EmptyState
            icon={<MessageCircleQuestion className="size-6" />}
            title="등록된 질문이 아직 없어요"
            description="도움말을 준비하고 있어요. 잠시 후 다시 확인해주세요."
          />
        )}
      </section>
    </div>
  );
}
