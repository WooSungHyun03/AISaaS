import Link from "next/link";
import { Search } from "lucide-react";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/server/admin/access";
import { listAdminRefunds } from "@/server/admin/operations";
import { REFUND_REQUEST_STATUSES, REFUND_REQUEST_STATUS_LABEL, type RefundRequestStatus } from "@/types/refunds";

const format = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
export default async function AdminRefundsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const params = await searchParams;
  const status = REFUND_REQUEST_STATUSES.includes(params.status as RefundRequestStatus) ? params.status as RefundRequestStatus : undefined;
  const { admin } = await requireAdmin({ action: "ADMIN_REFUNDS_VIEW", targetType: "route", targetId: "/admin/refunds", onDenied: "navigate" });
  const data = await listAdminRefunds(admin, { search: params.q, status, page: Number(params.page) || 1 });
  const href = (page: number) => `/admin/refunds?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), ...(status ? { status } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`;
  return <div className="space-y-6"><PageHeader title="환불 요청" description="요청을 검토하고 승인된 테스트 결제를 취소합니다." />
    <form className="grid max-w-3xl gap-2 sm:grid-cols-[1fr_180px_auto]"><Input name="q" defaultValue={params.q} placeholder="사용자 이메일" /><NativeSelect name="status" defaultValue={status ?? ""}><option value="">전체 상태</option>{REFUND_REQUEST_STATUSES.map((value) => <option key={value} value={value}>{REFUND_REQUEST_STATUS_LABEL[value]}</option>)}</NativeSelect><Button type="submit" variant="outline"><Search />조회</Button></form>
    <section className="overflow-hidden rounded-2xl border bg-card"><Table><TableHeader><TableRow><TableHead>요청일</TableHead><TableHead>사용자</TableHead><TableHead>상품</TableHead><TableHead>미사용</TableHead><TableHead>예정액</TableHead><TableHead>상태</TableHead><TableHead /></TableRow></TableHeader><TableBody>{data.items.map((item) => <TableRow key={item.id}><TableCell>{format.format(new Date(item.created_at))}</TableCell><TableCell>{item.userEmail}</TableCell><TableCell>{item.productName}<br /><span className="text-xs text-muted-foreground">{item.provider}</span></TableCell><TableCell>{item.unused_credits_snapshot}회</TableCell><TableCell>{item.expected_refund_krw.toLocaleString()}원</TableCell><TableCell><Badge variant={item.status === "REFUNDED" ? "success" : item.status === "REJECTED" ? "destructive" : "warning"}>{REFUND_REQUEST_STATUS_LABEL[item.status]}</Badge></TableCell><TableCell><Button asChild size="sm" variant="outline"><Link href={`/admin/refunds/${item.id}`}>처리</Link></Button></TableCell></TableRow>)}</TableBody></Table>{data.items.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">환불 요청이 없습니다.</p>}<AdminPagination page={data.page} total={data.total} href={href} /></section>
  </div>;
}
