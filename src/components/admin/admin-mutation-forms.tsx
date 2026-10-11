"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import type { AdminActionState } from "@/app/(admin)/admin/users/[id]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

const initialState: AdminActionState = { ok: false, message: "" };

function Feedback({ state }: { state: AdminActionState }) {
  return state.message ? <p role="status" className={state.ok ? "text-sm text-success" : "text-sm text-destructive"}>{state.message}</p> : null;
}

export function AccountStatusForm({ action, suspended }: { action: (state: AdminActionState, data: FormData) => Promise<AdminActionState>; suspended: boolean }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return <form action={formAction} className="space-y-4" onSubmit={(event) => { if (!window.confirm(suspended ? "이 계정의 정지를 해제할까요?" : "이 계정을 정지할까요? 로그인과 서비스 이용이 차단됩니다.")) event.preventDefault(); }}>
    <input type="hidden" name="status" value={suspended ? "ACTIVE" : "SUSPENDED"} />
    {!suspended && <div className="space-y-2"><Label htmlFor="suspension-reason">정지 사유</Label><Input id="suspension-reason" name="reason" minLength={3} maxLength={500} required placeholder="예: 비정상적인 자동화 반복 호출" /></div>}
    <Feedback state={state} />
    <Button type="submit" variant={suspended ? "default" : "destructive"} disabled={pending}>{pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}{suspended ? "계정 활성화" : "계정 정지"}</Button>
  </form>;
}

export function RefundReviewForm({ action, status }: { action: (state: AdminActionState, data: FormData) => Promise<AdminActionState>; status: string }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const canReview = status === "REQUESTED" || status === "REVIEWING";
  return <form action={formAction} className="space-y-4">
    <div className="space-y-2"><Label htmlFor="refund-decision">처리 상태</Label><NativeSelect id="refund-decision" name="decision" disabled={!canReview} defaultValue={status === "REQUESTED" ? "REVIEWING" : "APPROVED"}>
      {status === "REQUESTED" && <option value="REVIEWING">검토 시작</option>}
      <option value="APPROVED">승인</option><option value="REJECTED">거절</option>
    </NativeSelect></div>
    <div className="space-y-2"><Label htmlFor="refund-note">검토 메모</Label><Textarea id="refund-note" name="note" maxLength={1000} placeholder="고객에게 공개되지 않는 운영 메모" disabled={!canReview} /></div>
    <Feedback state={state} />
    <Button type="submit" disabled={!canReview || pending}>{pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}상태 저장</Button>
  </form>;
}

export function RefundExecuteForm({ action, enabled }: { action: (state: AdminActionState, data: FormData) => Promise<AdminActionState>; enabled: boolean }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return <form action={formAction} className="space-y-3" onSubmit={(event) => { if (!window.confirm("토스 테스트 결제를 취소하고 미사용 크레딧을 회수할까요?")) event.preventDefault(); }}>
    <Feedback state={state} />
    <Button type="submit" variant="destructive" disabled={!enabled || pending}>{pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}환불 실행</Button>
  </form>;
}
