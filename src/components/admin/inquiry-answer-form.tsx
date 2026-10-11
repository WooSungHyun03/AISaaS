"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { answerInquiryAction, type AdminInquiryActionState } from "@/app/(admin)/admin/inquiries/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { INQUIRY_REPLY_MAX, INQUIRY_STATUSES, INQUIRY_STATUS_LABEL, type InquiryStatus } from "@/types/inquiries";

const initialState: AdminInquiryActionState = {};

export function InquiryAnswerForm({ id, status }: { id: string; status: InquiryStatus }) {
  const [state, formAction, isPending] = useActionState(answerInquiryAction.bind(null, id), initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.success) return;
    toast.success("저장했어요.");
    formRef.current?.querySelector("textarea")?.form?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 rounded-2xl border bg-card p-5">
      <div className="space-y-2">
        <Label htmlFor="admin-reply">답변</Label>
        <Textarea id="admin-reply" name="reply" rows={6} maxLength={INQUIRY_REPLY_MAX} placeholder="고객에게 보여질 답변이에요. 비워두고 상태만 바꿀 수도 있어요." disabled={isPending} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="admin-status">상태</Label>
        <NativeSelect id="admin-status" name="status" defaultValue="" disabled={isPending}>
          <option value="">자동 (답변하면 ‘답변 완료’)</option>
          {INQUIRY_STATUSES.map((value) => <option key={value} value={value}>{INQUIRY_STATUS_LABEL[value]}{value === status ? " (현재)" : ""}</option>)}
        </NativeSelect>
      </div>
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
      <div className="flex justify-end"><Button type="submit" disabled={isPending}>{isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}{isPending ? "저장하는 중…" : "저장"}</Button></div>
    </form>
  );
}
