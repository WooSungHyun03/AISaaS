import { notFound } from "next/navigation";
import { ArrowLeft, Ban, Coins, History, ReceiptText } from "lucide-react";
import Link from "next/link";
import { AccountStatusForm } from "@/components/admin/admin-mutation-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/server/admin/access";
import { getAdminUserDetail } from "@/server/admin/operations";
import { setAccountStatusAction } from "./actions";

const format = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { admin } = await requireAdmin({ action: "ADMIN_USER_DETAIL_VIEW", targetType: "user", targetId: id, onDenied: "navigate" });
  const data = await getAdminUserDetail(admin, id);
  if (!data) notFound();
  const action = setAccountStatusAction.bind(null, id);
  return <div className="space-y-6">
    <Link href="/admin/users" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />사용자 목록</Link>
    <PageHeader title={data.profile.email} description={`${data.profile.display_name ?? "이름 미입력"} · 가입 ${format.format(new Date(data.profile.created_at))}`} actions={<Badge variant={data.profile.account_status === "ACTIVE" ? "success" : "destructive"}>{data.profile.account_status === "ACTIVE" ? "활성" : "정지"}</Badge>} />
    <div className="grid gap-5 lg:grid-cols-3">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Ban className="size-4" />계정 상태</CardTitle></CardHeader><CardContent><AccountStatusForm action={action} suspended={data.profile.account_status === "SUSPENDED"} />{data.profile.suspension_reason && <p className="mt-4 text-sm text-muted-foreground">현재 사유: {data.profile.suspension_reason}</p>}</CardContent></Card>
      <Card className="lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2"><Coins className="size-4" />잔여 크레딧</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{(["BLOG", "SHORTS"] as const).map((kind) => { const grants = data.grants.filter((g) => g.kind === kind); return <div key={kind} className="rounded-xl bg-muted p-4"><p className="text-xs font-semibold text-muted-foreground">{kind === "BLOG" ? "블로그" : "숏폼"}</p><p className="mt-1 text-2xl font-extrabold">{grants.reduce((sum, g) => sum + g.remaining, 0)}회</p><p className="text-xs text-muted-foreground">총 지급 {grants.reduce((sum, g) => sum + g.amount, 0)}회</p></div>; })}</CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ReceiptText className="size-4" />구매 상품</CardTitle></CardHeader><CardContent>{data.orders.length ? <ul className="divide-y">{data.orders.map((order) => <li key={order.id} className="flex justify-between gap-4 py-3 text-sm"><span><strong>{order.productName}</strong><br /><span className="text-muted-foreground">{order.provider} · {format.format(new Date(order.created_at))}</span></span><span className="text-right">{order.price_krw.toLocaleString()}원<br /><Badge variant="secondary">{order.status}</Badge></span></li>)}</ul> : <p className="text-sm text-muted-foreground">구매 내역이 없습니다.</p>}</CardContent></Card>
    <div className="grid gap-5 xl:grid-cols-2">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4" />최근 이용내역</CardTitle></CardHeader><CardContent>{data.runs.length ? <ul className="divide-y">{data.runs.slice(0, 20).map((run) => <li key={run.id} className="flex justify-between gap-3 py-3 text-sm"><span>{run.automationName}<br /><span className="text-xs text-muted-foreground">{format.format(new Date(run.created_at))}</span></span><Badge variant={run.status === "SUCCESS" ? "success" : run.status === "FAILED" ? "destructive" : "secondary"}>{run.status}</Badge></li>)}</ul> : <p className="text-sm text-muted-foreground">이용내역이 없습니다.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Coins className="size-4" />크레딧 원장</CardTitle></CardHeader><CardContent>{data.ledger.length ? <ul className="divide-y">{data.ledger.slice(0, 20).map((entry) => <li key={entry.id} className="flex justify-between gap-3 py-3 text-sm"><span>{entry.kind} · {entry.event_type}<br /><span className="text-xs text-muted-foreground">{format.format(new Date(entry.created_at))}</span></span><strong className={entry.delta > 0 ? "text-success" : entry.delta < 0 ? "text-destructive" : ""}>{entry.delta > 0 ? "+" : ""}{entry.delta}</strong></li>)}</ul> : <p className="text-sm text-muted-foreground">원장 기록이 없습니다.</p>}</CardContent></Card>
    </div>
  </div>;
}
