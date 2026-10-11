"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { submitInquiryAction, type InquiryActionState } from "@/app/(app)/support/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { INQUIRY_BODY, INQUIRY_CATEGORIES, INQUIRY_CATEGORY_LABEL, INQUIRY_SUBJECT } from "@/types/inquiries";

const initialState: InquiryActionState = {};

export function InquiryForm() {
  const [state, formAction, isPending] = useActionState(submitInquiryAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [bodyLength, setBodyLength] = useState(0);

  useEffect(() => {
    if (!state.success) return;
    toast.success("문의를 보냈어요. 답변이 오면 아래 내 문의 내역에서 확인할 수 있어요.");
    formRef.current?.reset();
    // The browser reset the fields; clear the counter with it.
    const timer = window.setTimeout(() => setBodyLength(0), 0);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6" aria-describedby={state.error ? "inquiry-error" : undefined}>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <div className="space-y-2">
          <Label htmlFor="inquiry-category">문의 유형</Label>
          <NativeSelect id="inquiry-category" name="category" defaultValue="" required disabled={isPending}>
            <option value="" disabled>유형 선택</option>
            {INQUIRY_CATEGORIES.map((category) => <option key={category} value={category}>{INQUIRY_CATEGORY_LABEL[category]}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="inquiry-subject">제목</Label>
          <Input id="inquiry-subject" name="subject" minLength={INQUIRY_SUBJECT.min} maxLength={INQUIRY_SUBJECT.max} placeholder="한 줄로 요약해주세요" required disabled={isPending} />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="inquiry-body">내용</Label>
          <span className="tabular text-xs text-muted-foreground">{bodyLength.toLocaleString()} / {INQUIRY_BODY.max.toLocaleString()}</span>
        </div>
        <Textarea id="inquiry-body" name="body" rows={6} minLength={INQUIRY_BODY.min} maxLength={INQUIRY_BODY.max} onChange={(event) => setBodyLength(event.target.value.length)} placeholder="어떤 상황인지 자세히 적어주세요. 결제 문의라면 주문 날짜와 상품명을 함께 알려주세요. 비밀번호·카드번호는 적지 마세요." required disabled={isPending} />
      </div>
      {state.error ? <FormMessage id="inquiry-error">{state.error}</FormMessage> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>{isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}{isPending ? "보내는 중…" : "문의 보내기"}</Button>
      </div>
    </form>
  );
}
