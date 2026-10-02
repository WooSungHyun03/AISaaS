"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Loader2, LockKeyhole } from "lucide-react";
import { submitSetupRequest, type SetupRequestActionState } from "@/app/(app)/setup-request/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/ui/form-message";
import { SETUP_AUTOMATION_TYPES, SETUP_BUDGET_RANGES, SETUP_CONTACT_METHODS } from "@/types/setup-request";
import type { SetupRequestContactMethod } from "@/types/domain";

const initialState: SetupRequestActionState = {};

export function SetupRequestForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, formAction, isPending] = useActionState(submitSetupRequest, initialState);
  const [contactMethod, setContactMethod] = useState<SetupRequestContactMethod>("EMAIL");
  const [contactValue, setContactValue] = useState(defaultEmail);

  return (
    <form action={formAction} className="space-y-7" aria-describedby={state.error ? "setup-request-error" : undefined}>
      <section className="space-y-4" aria-labelledby="request-scope-title">
        <div><p className="text-xs font-bold text-primary">1단계</p><h2 id="request-scope-title" className="mt-1 text-lg font-extrabold tracking-[-0.03em]">어떤 도움이 필요한가요?</h2></div>
        <div className="space-y-2">
          <Label htmlFor="automationType">도움이 필요한 일 <span className="text-destructive" aria-hidden="true">*</span></Label>
          <Select name="automationType" required disabled={isPending}>
            <SelectTrigger id="automationType" className="w-full" aria-label="도움이 필요한 일"><SelectValue placeholder="골라주세요" /></SelectTrigger>
            <SelectContent>{SETUP_AUTOMATION_TYPES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="currentWork">지금 반복하고 있는 일 <span className="text-destructive" aria-hidden="true">*</span></Label>
          <Textarea id="currentWork" name="currentWork" required minLength={10} maxLength={2000} rows={4} disabled={isPending} placeholder="예: 매주 월·수·금에 키워드를 정하고 블로그 글을 직접 쓰고 있어요." />
          <p className="text-xs text-muted-foreground">쓰고 있는 도구와 반복 횟수를 함께 적으면 더 정확히 상담할 수 있어요.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="desiredOutcome">원하는 결과 <span className="text-destructive" aria-hidden="true">*</span></Label>
          <Textarea id="desiredOutcome" name="desiredOutcome" required minLength={10} maxLength={2000} rows={4} disabled={isPending} placeholder="예: 매주 3번, 우리 사업 키워드에 맞는 글 초안이 만들어져 있으면 좋겠어요." />
        </div>
      </section>

      <section className="space-y-4 border-t pt-7" aria-labelledby="request-budget-title">
        <div><p className="text-xs font-bold text-primary">2단계</p><h2 id="request-budget-title" className="mt-1 text-lg font-extrabold tracking-[-0.03em]">예산과 연락 방법을 알려주세요</h2></div>
        <div className="space-y-2">
          <Label htmlFor="budgetRange">예산 범위 <span className="text-destructive" aria-hidden="true">*</span></Label>
          <Select name="budgetRange" required disabled={isPending}>
            <SelectTrigger id="budgetRange" className="w-full" aria-label="예산 범위"><SelectValue placeholder="골라주세요" /></SelectTrigger>
            <SelectContent>{SETUP_BUDGET_RANGES.map((range) => <SelectItem key={range} value={range}>{range}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-2">
            <Label htmlFor="contactMethod">연락 방법 <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Select name="contactMethod" value={contactMethod} onValueChange={(value) => {
              const nextMethod = value as SetupRequestContactMethod;
              setContactMethod(nextMethod);
              setContactValue((current) => nextMethod === "EMAIL" && !current ? defaultEmail : nextMethod !== "EMAIL" && current === defaultEmail ? "" : current);
            }} required disabled={isPending}>
              <SelectTrigger id="contactMethod" className="w-full" aria-label="연락 방법"><SelectValue /></SelectTrigger>
              <SelectContent>{SETUP_CONTACT_METHODS.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactValue">연락받을 정보 <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Input
              id="contactValue"
              name="contactValue"
              type={contactMethod === "EMAIL" ? "email" : "text"}
              required
              maxLength={200}
              value={contactValue}
              onChange={(event) => setContactValue(event.target.value)}
              disabled={isPending}
              placeholder={contactMethod === "PHONE" ? "010-0000-0000" : contactMethod === "KAKAO" ? "카카오톡 ID" : "연락받을 수 있는 정보를 적어주세요"}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">추가 참고 사항 <span className="text-xs font-normal text-muted-foreground">선택</span></Label>
          <Textarea id="notes" name="notes" maxLength={2000} rows={3} disabled={isPending} placeholder="희망 일정, 꼭 써야 하는 도구 등 더 전하고 싶은 내용을 적어주세요." />
        </div>
      </section>

      {state.error ? <FormMessage id="setup-request-error">{state.error}</FormMessage> : null}

      <div className="space-y-3 border-t pt-6">
        <p className="flex items-start gap-2 text-[13px] leading-6 text-muted-foreground"><LockKeyhole className="mt-1 size-3.5 shrink-0" aria-hidden="true" />적어주신 연락처는 상담과 진행 안내에만 써요.</p>
        <Button type="submit" size="lg" className="w-full" disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {isPending ? "보내는 중…" : <>요청 보내기 <ArrowRight aria-hidden="true" /></>}
        </Button>
      </div>
    </form>
  );
}
