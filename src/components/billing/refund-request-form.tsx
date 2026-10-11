"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { submitRefundRequestAction, type RefundRequestActionState } from "@/app/(app)/billing/refunds/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { REFUND_REASON, type RefundOrderOption } from "@/types/refunds";

const initialState: RefundRequestActionState = {};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

export function RefundRequestForm({ orders, initialOrderId }: { orders: RefundOrderOption[]; initialOrderId?: string }) {
  const eligibleOrders = useMemo(() => orders.filter((order) => order.eligible), [orders]);
  const firstOrderId = eligibleOrders.some((order) => order.id === initialOrderId) ? initialOrderId! : eligibleOrders[0]?.id ?? "";
  const [selectedId, setSelectedId] = useState(firstOrderId);
  const [reasonLength, setReasonLength] = useState(0);
  const [state, formAction, pending] = useActionState(submitRefundRequestAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const effectiveSelectedId = eligibleOrders.some((order) => order.id === selectedId) ? selectedId : firstOrderId;
  const selected = eligibleOrders.find((order) => order.id === effectiveSelectedId);

  useEffect(() => {
    if (!state.success) return;
    toast.success("환불 요청을 접수했어요. 아래에서 진행 상태를 확인할 수 있어요.");
    formRef.current?.reset();
    const timer = window.setTimeout(() => setReasonLength(0), 0);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (eligibleOrders.length === 0) {
    return <FormMessage variant="info">현재 환불을 요청할 수 있는 주문이 없어요. 결제가 완료되고 유효기간과 이용권이 남은 주문만 요청할 수 있어요.</FormMessage>;
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6" aria-describedby={state.error ? "refund-request-error" : "refund-policy-note"}>
      <div className="space-y-2">
        <Label htmlFor="refund-order">대상 주문</Label>
        <NativeSelect id="refund-order" name="orderId" value={effectiveSelectedId} onChange={(event) => setSelectedId(event.target.value)} required disabled={pending}>
          {eligibleOrders.map((order) => (
            <option key={order.id} value={order.id}>{order.productName} · {formatDate(order.paidAt)} · 잔여 {order.remainingCredits}회</option>
          ))}
        </NativeSelect>
      </div>

      {selected ? (
        <dl className="grid gap-px overflow-hidden rounded-xl border bg-border text-sm sm:grid-cols-3">
          <div className="bg-muted/40 px-4 py-3"><dt className="text-xs text-muted-foreground">구매 / 남은 이용권</dt><dd className="tabular mt-1 font-bold">{selected.creditAmount}회 / {selected.remainingCredits}회</dd></div>
          <div className="bg-muted/40 px-4 py-3"><dt className="text-xs text-muted-foreground">유효기간</dt><dd className="tabular mt-1 font-bold">{selected.expiresAt ? formatDate(selected.expiresAt) : "확인 불가"}</dd></div>
          <div className="bg-muted/40 px-4 py-3"><dt className="text-xs text-muted-foreground">환불 예정액</dt><dd className="tabular mt-1 font-bold text-primary">{selected.expectedRefundKrw.toLocaleString()}원</dd></div>
        </dl>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="refund-reason">환불 사유</Label>
          <span className="tabular text-xs text-muted-foreground">{reasonLength.toLocaleString()} / {REFUND_REASON.max.toLocaleString()}</span>
        </div>
        <Textarea
          id="refund-reason"
          name="reason"
          rows={5}
          minLength={REFUND_REASON.min}
          maxLength={REFUND_REASON.max}
          onChange={(event) => setReasonLength(event.target.value.length)}
          placeholder="환불을 요청하는 이유를 10자 이상 적어주세요. 카드번호나 비밀번호는 적지 마세요."
          required
          disabled={pending}
        />
      </div>

      <FormMessage id="refund-policy-note" variant="info">환불 예정액은 남은 이용권 비율로 계산한 검토 기준 금액이에요. 제출 즉시 자동 환불되지 않으며, 담당자가 확인한 뒤 상태를 변경해요.</FormMessage>
      {state.error ? <FormMessage id="refund-request-error">{state.error}</FormMessage> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !effectiveSelectedId}>{pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}{pending ? "요청하는 중…" : "환불 요청 제출"}</Button>
      </div>
    </form>
  );
}

