import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CreditCard, RotateCcw } from "lucide-react";
import { RefundExecuteForm, RefundReviewForm } from "@/components/admin/admin-mutation-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/server/admin/access";
import { getAdminRefundDetail } from "@/server/admin/operations";
import { REFUND_REQUEST_STATUS_LABEL } from "@/types/refunds";
import { executeRefundAction, reviewRefundAction } from "./actions";

const format = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
export default async function AdminRefundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { admin } = await requireAdmin({ action: "ADMIN_REFUND_DETAIL_VIEW", targetType: "refund_request", targetId: id, onDenied: "navigate" });
  const data = await getAdminRefundDetail(admin, id);
  if (!data) notFound();
  return <div className="space-y-6"><Link href="/admin/refunds" className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />환불 요청 목록</Link>
    <PageHeader title={data.order.productName} description={`${data.userEmail} · ${format.format(new Date(data.request.created_at))}`} actions={<Badge variant={data.request.status === "REFUNDED" ? "success" : "warning"}>{REFUND_REQUEST_STATUS_LABEL[data.request.status]}</Badge>} />
    <div className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm"><strong>학교 프로젝트 데모 · 테스트 결제</strong><p className="mt-1 text-muted-foreground">이 화면의 토스 취소는 테스트 키만 허용하며 실제 금액은 청구되지 않습니다.</p></div>
    <div className="grid gap-5 lg:grid-cols-2"><Card><CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="size-4" />요청 정보</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p><span className="text-muted-foreground">사유</span><br />{data.request.reason}</p><dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted p-4"><div><dt className="text-xs text-muted-foreground">사용/미사용</dt><dd className="font-bold">{data.request.used_credits_snapshot} / {data.request.unused_credits_snapshot}회</dd></div><div><dt className="text-xs text-muted-foreground">환불 예정</dt><dd className="font-bold">{data.request.expected_refund_krw.toLocaleString()}원</dd></div><div><dt className="text-xs text-muted-foreground">결제사</dt><dd>{data.order.provider}</dd></div><div><dt className="text-xs text-muted-foreground">현재 잔여</dt><dd>{data.grant?.remaining ?? 0}회</dd></div></dl>{data.request.review_note && <p><span className="text-muted-foreground">검토 메모</span><br />{data.request.review_note}</p>}{data.request.refund_last_error && <div className="rounded-lg bg-destructive/10 p-3 text-destructive"><strong>최근 실행 오류</strong><p>{data.request.refund_last_error}</p><p className="mt-1 text-xs">시도 {data.request.refund_attempt_count}회 · 같은 멱등 키로 재시도됩니다.</p></div>}</CardContent></Card>
      <div className="space-y-5"><Card><CardHeader><CardTitle>1. 검토</CardTitle></CardHeader><CardContent><RefundReviewForm action={reviewRefundAction.bind(null, id)} status={data.request.status} /></CardContent></Card><Card><CardHeader><CardTitle className="flex items-center gap-2"><RotateCcw className="size-4" />2. 환불 실행</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">승인 후 실행합니다. 결제 취소 성공 시 주문 상태와 미사용 크레딧 원장이 한 트랜잭션으로 반영됩니다.</p><RefundExecuteForm action={executeRefundAction.bind(null, id)} enabled={data.request.status === "APPROVED"} /></CardContent></Card></div></div>
  </div>;
}
