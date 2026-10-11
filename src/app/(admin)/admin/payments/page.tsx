import { Search } from "lucide-react";
import { AdminPagination } from "@/components/admin/admin-pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/server/admin/access";
import { listAdminPayments } from "@/server/admin/operations";

const format = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
export default async function AdminPaymentsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const params = await searchParams;
  const { admin } = await requireAdmin({ action: "ADMIN_PAYMENTS_VIEW", targetType: "route", targetId: "/admin/payments", onDenied: "navigate" });
  const data = await listAdminPayments(admin, { search: params.q, status: params.status, page: Number(params.page) || 1 });
  const href = (page: number) => `/admin/payments?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), ...(params.status ? { status: params.status } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`;
  return <div className="space-y-6"><PageHeader title="결제 내역" description="테스트 결제 주문과 환불 상태를 확인합니다." />
    <form className="grid max-w-3xl gap-2 sm:grid-cols-[1fr_180px_auto]"><Input name="q" defaultValue={params.q} placeholder="사용자 이메일" aria-label="사용자 이메일 검색" /><NativeSelect name="status" defaultValue={params.status ?? ""} aria-label="결제 상태"><option value="">전체 상태</option>{["PENDING", "PAID", "CANCELED", "REFUNDED"].map((status) => <option key={status}>{status}</option>)}</NativeSelect><Button type="submit" variant="outline"><Search />조회</Button></form>
    <section className="overflow-hidden rounded-2xl border bg-card"><Table><TableHeader><TableRow><TableHead>일시</TableHead><TableHead>사용자</TableHead><TableHead>상품</TableHead><TableHead>결제사</TableHead><TableHead>금액</TableHead><TableHead>상태</TableHead></TableRow></TableHeader><TableBody>{data.items.map((item) => <TableRow key={item.id}><TableCell>{format.format(new Date(item.paid_at ?? item.created_at))}</TableCell><TableCell>{item.userEmail}</TableCell><TableCell>{item.productName}<br /><span className="text-xs text-muted-foreground">{item.credit_amount}회</span></TableCell><TableCell>{item.provider}</TableCell><TableCell>{item.price_krw.toLocaleString()}원</TableCell><TableCell><Badge variant={item.status === "PAID" ? "success" : item.status === "REFUNDED" ? "warning" : "secondary"}>{item.status}</Badge></TableCell></TableRow>)}</TableBody></Table>{data.items.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">결제 내역이 없습니다.</p>}<AdminPagination page={data.page} total={data.total} href={href} /></section>
  </div>;
}
