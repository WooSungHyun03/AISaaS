import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requireAdmin } from "@/server/admin/access";
import { getInquiryForAdmin } from "@/server/inquiries/inquiries";
import { PageHeader } from "@/components/layout/page-header";
import { InquiryAnswerForm } from "@/components/admin/inquiry-answer-form";
import { InquiryStatusBadge } from "@/components/support/inquiry-status-badge";
import { InquiryThread } from "@/components/support/inquiry-thread";
import { INQUIRY_CATEGORY_LABEL } from "@/types/inquiries";

export const metadata = { title: "문의 답변" };

const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function AdminInquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { admin } = await requireAdmin({ action: "ADMIN_INQUIRY_VIEW", targetType: "inquiry", onDenied: "navigate" });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const inquiry = await getInquiryForAdmin(admin, id);
  if (!inquiry) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/admin/inquiries" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />문의 목록</Link>
      <PageHeader title={inquiry.subject} description={`${INQUIRY_CATEGORY_LABEL[inquiry.category]} · ${inquiry.userEmail} · ${dateFormat.format(new Date(inquiry.createdAt))}`} actions={<InquiryStatusBadge status={inquiry.status} />} />
      <section aria-label="문의 내용" className="rounded-2xl border bg-card p-5">
        <p className="whitespace-pre-line text-[15px] leading-7">{inquiry.body}</p>
      </section>
      <section aria-label="처리 내역" className="space-y-3">
        <h2 className="text-lg font-extrabold tracking-[-0.03em]">처리 내역</h2>
        <InquiryThread messages={inquiry.messages} />
      </section>
      <InquiryAnswerForm id={inquiry.id} status={inquiry.status} />
    </div>
  );
}
