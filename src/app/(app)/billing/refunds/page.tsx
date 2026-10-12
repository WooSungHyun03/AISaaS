import Link from "next/link";
import { ArrowLeft, ClipboardList, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRefundRequestPageData } from "@/server/billing/refund-requests";
import { isMissingSchemaError } from "@/server/shared/db-errors";
import { PageHeader } from "@/components/layout/page-header";
import { RefundRequestForm } from "@/components/billing/refund-request-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { FormMessage } from "@/components/ui/form-message";
import { REFUND_REQUEST_STATUS_LABEL, type RefundRequestStatus } from "@/types/refunds";

export const metadata = { title: "환불 요청" };

const STATUS_VARIANT: Record<RefundRequestStatus, "secondary" | "warning" | "success" | "destructive"> = {
  REQUESTED: "secondary",
  REVIEWING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
  REFUNDED: "success",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default async function RefundRequestsPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let data: Awaited<ReturnType<typeof getRefundRequestPageData>> | null = null;
  let schemaUnavailable = false;
  try {
    data = await getRefundRequestPageData(user.id);
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    schemaUnavailable = true;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-9 pb-10">
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm"><Link href="/billing"><ArrowLeft aria-hidden="true" />요금제로 돌아가기</Link></Button>
        <PageHeader title="환불 요청" description="결제가 완료된 주문을 선택하고 환불 사유와 처리 상태를 확인하세요." />
      </div>

      <FormMessage variant="info"><strong>학교 프로젝트 데모 · 테스트 결제</strong> 환경이에요. 실제 카드 청구나 금전 환불은 발생하지 않으며, 아래 절차는 환불 요청과 검토 흐름을 확인하기 위한 기능이에요.</FormMessage>

      {schemaUnavailable || !data ? (
        <FormMessage>환불 요청 기능을 준비하는 중이에요. 서비스 관리자가 데이터베이스 업데이트를 마치면 바로 쓸 수 있어요.</FormMessage>
      ) : (
        <>
          <section aria-labelledby="refund-form-heading" className="space-y-4">
            <div><h2 id="refund-form-heading" className="text-lg font-extrabold tracking-[-0.03em]">새 환불 요청</h2><p className="mt-1 text-sm text-muted-foreground">유효기간이 남은 미사용 이용권 비율로 환불 예정액을 계산해요.</p></div>
            <RefundRequestForm orders={data.orders} initialOrderId={params.order} />
            {data.orders.some((order) => !order.eligible) ? (
              <details className="rounded-xl border px-4 py-3 text-sm">
                <summary className="cursor-pointer font-semibold">요청할 수 없는 주문 보기</summary>
                <ul className="mt-3 space-y-2 text-muted-foreground">
                  {data.orders.filter((order) => !order.eligible).map((order) => <li key={order.id}><span className="font-medium text-foreground">{order.productName}</span> · {order.ineligibleReason}</li>)}
                </ul>
              </details>
            ) : null}
          </section>

          <section aria-labelledby="refund-history-heading" className="space-y-4">
            <div><h2 id="refund-history-heading" className="flex items-center gap-2 text-lg font-extrabold tracking-[-0.03em]"><ClipboardList className="size-5" aria-hidden="true" />환불 요청 내역</h2><p className="mt-1 text-sm text-muted-foreground">담당자가 검토하면 상태가 이곳에 반영돼요.</p></div>
            {data.requests.length === 0 ? (
              <EmptyState icon={<RotateCcw className="size-6" />} title="환불 요청이 없어요" description="요청을 제출하면 접수 상태와 환불 예정액을 여기에서 확인할 수 있어요." />
            ) : (
              <div className="space-y-3">
                {data.requests.map((request) => (
                  <article key={request.id} className="rounded-2xl border bg-card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div><h3 className="font-bold">{request.productName}</h3><p className="tabular mt-1 text-xs text-muted-foreground">요청번호 {request.id.slice(0, 8).toUpperCase()} · {formatDate(request.createdAt)}</p></div>
                      <Badge variant={STATUS_VARIANT[request.status]}>{REFUND_REQUEST_STATUS_LABEL[request.status]}</Badge>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-xs text-muted-foreground">사용 / 미사용</dt><dd className="tabular mt-1 font-semibold">{request.usedCredits}회 / {request.unusedCredits}회</dd></div><div><dt className="text-xs text-muted-foreground">환불 예정액</dt><dd className="tabular mt-1 font-semibold">{request.expectedRefundKrw.toLocaleString()}원</dd></div><div><dt className="text-xs text-muted-foreground">최근 변경</dt><dd className="tabular mt-1 font-semibold">{formatDate(request.updatedAt)}</dd></div></dl>
                    <div className="mt-4 rounded-lg bg-muted/60 px-4 py-3 text-sm leading-6"><span className="font-semibold">요청 사유</span><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{request.reason}</p></div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

