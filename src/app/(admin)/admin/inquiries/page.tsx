import Link from "next/link";
import { requireAdmin } from "@/server/admin/access";
import { ADMIN_PAGE_SIZE, listInquiriesForAdmin } from "@/server/inquiries/inquiries";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InquiryStatusBadge } from "@/components/support/inquiry-status-badge";
import { cn } from "@/lib/utils";
import { INQUIRY_CATEGORY_LABEL, INQUIRY_STATUSES, INQUIRY_STATUS_LABEL, type InquiryStatus } from "@/types/inquiries";

export const metadata = { title: "고객 문의 관리" };

const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function AdminInquiriesPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string; q?: string }> }) {
  const { admin } = await requireAdmin({ action: "ADMIN_INQUIRIES_VIEW", targetType: "route", targetId: "/admin/inquiries", onDenied: "navigate" });
  const query = await searchParams;

  const status = (INQUIRY_STATUSES as readonly string[]).includes(query.status ?? "") ? (query.status as InquiryStatus) : undefined;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const { items, total } = await listInquiriesForAdmin(admin, { status, page, search: query.q });
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const href = (nextStatus?: string, nextPage = 1) => `/admin/inquiries?${new URLSearchParams({ ...(nextStatus ? { status: nextStatus } : {}), ...(query.q ? { q: query.q } : {}), ...(nextPage > 1 ? { page: String(nextPage) } : {}) }).toString()}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="고객 문의 관리" description={`총 ${total.toLocaleString()}건 (한국 시간)`} />
      <form className="flex max-w-xl gap-2"><Input name="q" defaultValue={query.q} placeholder="사용자 이메일 검색" /><Button type="submit" variant="outline">검색</Button></form>
      <nav className="flex flex-wrap gap-2" aria-label="상태별 보기">
        {[{ value: undefined, label: "전체" }, ...INQUIRY_STATUSES.map((value) => ({ value, label: INQUIRY_STATUS_LABEL[value] }))].map((item) => (
          <Link key={item.label} href={href(item.value)} aria-current={status === item.value ? "page" : undefined} className={cn("inline-flex h-9 items-center rounded-full border px-4 text-sm font-semibold", status === item.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40")}>{item.label}</Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-5 py-10 text-center text-sm text-muted-foreground">해당하는 문의가 없어요.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={`/admin/inquiries/${item.id}`} className="flex flex-col gap-1 px-5 py-4 transition-colors hover:bg-brand-soft/50 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex min-w-0 flex-wrap items-center gap-2"><InquiryStatusBadge status={item.status} /><span className="min-w-0 break-words font-semibold">{item.subject}</span></span>
                <span className="tabular text-[13px] text-muted-foreground">{INQUIRY_CATEGORY_LABEL[item.category]} · {item.userEmail} · {dateFormat.format(new Date(item.createdAt))}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="flex items-center justify-between" aria-label="페이지">
          <Button asChild variant="outline" disabled={page <= 1}><Link href={href(status, Math.max(1, page - 1))} aria-disabled={page <= 1}>이전</Link></Button>
          <span className="tabular text-sm text-muted-foreground">{page} / {pages}</span>
          <Button asChild variant="outline" disabled={page >= pages}><Link href={href(status, Math.min(pages, page + 1))} aria-disabled={page >= pages}>다음</Link></Button>
        </nav>
      ) : null}
    </div>
  );
}
