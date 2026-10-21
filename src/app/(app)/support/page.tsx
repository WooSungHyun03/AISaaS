import Link from "next/link";
import { MessageCircleQuestion } from "lucide-react";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { listPublishedFaqs } from "@/server/customer-support/faq";
import { listMyInquiries } from "@/server/inquiries/inquiries";
import { isAdminUser } from "@/server/admin/access";
import { PageHeader } from "@/components/layout/page-header";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { EmptyState } from "@/components/ui/page-state";
import { InquiryForm } from "@/components/support/inquiry-form";
import { MyInquiries } from "@/components/support/my-inquiries";
import { FormMessage } from "@/components/ui/form-message";
import { isMissingSchemaError } from "@/server/shared/db-errors";

export const metadata = { title: "문의" };

export default async function SupportPage() {
  const supabase = await createClient();
  const user = await getAuthUser();
  const faqs = await listPublishedFaqs(supabase);
  let inquiries: Awaited<ReturnType<typeof listMyInquiries>> = [];
  let inquiriesUnavailable = false;
  let isAdmin = false;
  if (user) {
    isAdmin = await isAdminUser(user.id).catch(() => false);
    try {
      inquiries = await listMyInquiries(supabase, user.id);
    } catch (error) {
      // A database that has not received the inquiry migration yet still shows the FAQ.
      if (!isMissingSchemaError(error)) throw error;
      inquiriesUnavailable = true;
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <PageHeader title="문의" description="궁금한 점은 먼저 자주 묻는 질문에서 찾아보고, 없으면 바로 문의를 남겨주세요." />

      <FormMessage variant="info"><strong>학교 프로젝트 데모 · 테스트 결제</strong> 환경이에요. 실제 청구나 금전 환불은 발생하지 않아요. 주문 환불을 요청하려면 <Link href="/billing/refunds" className="font-semibold text-primary underline underline-offset-2">환불 요청 화면</Link>을 이용해주세요.</FormMessage>

      {isAdmin ? (
        <p className="rounded-xl bg-brand-soft px-4 py-3 text-sm">관리자 계정이에요. <Link href="/admin" className="font-semibold text-primary underline underline-offset-2">관리자 대시보드로 가기</Link></p>
      ) : null}

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
          <EmptyState icon={<MessageCircleQuestion className="size-6" />} title="등록된 질문이 아직 없어요" description="도움말을 준비하고 있어요. 문의를 남겨주시면 직접 답해드려요." />
        )}
      </section>

      <section aria-labelledby="inquiry-form-title" className="space-y-4">
        <div>
          <h2 id="inquiry-form-title" className="text-lg font-extrabold tracking-[-0.03em]">문의하기</h2>
          <p className="mt-1 text-sm text-muted-foreground">결제·환불·서비스 오류·기타 문의를 남겨주세요. 보통 영업일 기준 1~2일 안에 답해드려요.</p>
        </div>
        {inquiriesUnavailable ? <FormMessage variant="info">문의 기능을 준비하는 중이에요. 서비스 관리자가 데이터베이스 업데이트를 마치면 바로 쓸 수 있어요.</FormMessage> : <InquiryForm />}
      </section>

      {inquiriesUnavailable ? null : (
        <section aria-labelledby="my-inquiries-title" className="space-y-4">
          <h2 id="my-inquiries-title" className="text-lg font-extrabold tracking-[-0.03em]">내 문의 내역</h2>
          <MyInquiries inquiries={inquiries} />
        </section>
      )}
    </div>
  );
}
