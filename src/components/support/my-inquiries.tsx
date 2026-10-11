"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { closeInquiryAction } from "@/app/(app)/support/actions";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { INQUIRY_CATEGORY_LABEL, type InquiryView } from "@/types/inquiries";
import { InquiryStatusBadge } from "./inquiry-status-badge";
import { InquiryThread } from "./inquiry-thread";

const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric" });

export function MyInquiries({ inquiries }: { inquiries: InquiryView[] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function close(id: string) {
    startTransition(async () => {
      const result = await closeInquiryAction(id);
      if (result.error) toast.error(result.error);
      else toast.success("문의를 종료했어요.");
      router.refresh();
    });
  }

  if (inquiries.length === 0) {
    return <p className="rounded-2xl border border-dashed px-5 py-8 text-center text-sm text-muted-foreground">아직 보낸 문의가 없어요.</p>;
  }
  return (
    <Accordion type="single" collapsible className="rounded-2xl border bg-card px-5 sm:px-6">
      {inquiries.map((inquiry) => (
        <AccordionItem key={inquiry.id} value={inquiry.id}>
          <AccordionTrigger>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left">
              <InquiryStatusBadge status={inquiry.status} />
              <span className="min-w-0 break-words font-semibold">{inquiry.subject}</span>
              <span className="tabular text-xs font-normal text-muted-foreground">{INQUIRY_CATEGORY_LABEL[inquiry.category]} · {dateFormat.format(new Date(inquiry.createdAt))}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4">
            <p className="whitespace-pre-line rounded-xl bg-muted/50 px-4 py-3 text-[15px] leading-7">{inquiry.body}</p>
            <InquiryThread messages={inquiry.messages} />
            {inquiry.status !== "CLOSED" ? (
              <div className="flex justify-end"><Button type="button" variant="outline" size="sm" onClick={() => close(inquiry.id)} disabled={pending}>해결됐어요, 문의 종료</Button></div>
            ) : null}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
