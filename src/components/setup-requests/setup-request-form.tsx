"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Loader2, LockKeyhole } from "lucide-react";
import { submitSetupRequest, type SetupRequestActionState } from "@/app/(app)/setup-request/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SETUP_AUTOMATION_TYPES, SETUP_BUDGET_RANGES, SETUP_CONTACT_METHODS } from "@/types/setup-request";
import type { SetupRequestContactMethod } from "@/types/domain";

const initialState: SetupRequestActionState = {};

export function SetupRequestForm({ defaultEmail }: { defaultEmail: string }) {
  const [state, formAction, isPending] = useActionState(submitSetupRequest, initialState);
  const [contactMethod, setContactMethod] = useState<SetupRequestContactMethod>("EMAIL");
  const [contactValue, setContactValue] = useState(defaultEmail);

  return (
    <form action={formAction} className="space-y-7">
      <section className="space-y-4" aria-labelledby="request-scope-title">
        <div><p className="text-xs font-semibold text-blue-700">01</p><h2 id="request-scope-title" className="mt-1 text-lg font-semibold">어떤 자동화가 필요한가요?</h2></div>
        <div className="space-y-2">
          <Label htmlFor="automationType">자동화 유형 <span className="text-destructive">*</span></Label>
          <Select name="automationType" required>
            <SelectTrigger id="automationType" className="w-full"><SelectValue placeholder="필요한 자동화를 선택하세요" /></SelectTrigger>
            <SelectContent>{SETUP_AUTOMATION_TYPES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="currentWork">현재 반복하고 있는 업무 <span className="text-destructive">*</span></Label>
          <Textarea id="currentWork" name="currentWork" required minLength={10} maxLength={2000} rows={4} placeholder="예: 매주 월·수·금에 키워드를 정하고 블로그 글을 직접 작성한 뒤 WordPress에 게시하고 있습니다." />
          <p className="text-xs text-muted-foreground">사용 중인 도구와 반복 횟수를 함께 적으면 더 정확하게 상담할 수 있습니다.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="desiredOutcome">원하는 자동화 결과 <span className="text-destructive">*</span></Label>
          <Textarea id="desiredOutcome" name="desiredOutcome" required minLength={10} maxLength={2000} rows={4} placeholder="예: 매주 3회 사업 키워드에 맞는 글이 자동으로 작성되고 검토용 WordPress 초안으로 저장되면 좋겠습니다." />
        </div>
      </section>

      <section className="space-y-4 border-t pt-7" aria-labelledby="request-budget-title">
        <div><p className="text-xs font-semibold text-blue-700">02</p><h2 id="request-budget-title" className="mt-1 text-lg font-semibold">예산과 연락 방법을 알려주세요</h2></div>
        <div className="space-y-2">
          <Label htmlFor="budgetRange">예산 범위 <span className="text-destructive">*</span></Label>
          <Select name="budgetRange" required>
            <SelectTrigger id="budgetRange" className="w-full"><SelectValue placeholder="예산 범위를 선택하세요" /></SelectTrigger>
            <SelectContent>{SETUP_BUDGET_RANGES.map((range) => <SelectItem key={range} value={range}>{range}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-2">
            <Label htmlFor="contactMethod">연락 방법 <span className="text-destructive">*</span></Label>
            <Select name="contactMethod" value={contactMethod} onValueChange={(value) => {
              const nextMethod = value as SetupRequestContactMethod;
              setContactMethod(nextMethod);
              setContactValue((current) => nextMethod === "EMAIL" && !current ? defaultEmail : nextMethod !== "EMAIL" && current === defaultEmail ? "" : current);
            }} required>
              <SelectTrigger id="contactMethod" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{SETUP_CONTACT_METHODS.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactValue">연락받을 정보 <span className="text-destructive">*</span></Label>
            <Input
              id="contactValue"
              name="contactValue"
              type={contactMethod === "EMAIL" ? "email" : "text"}
              required
              maxLength={200}
              value={contactValue}
              onChange={(event) => setContactValue(event.target.value)}
              placeholder={contactMethod === "PHONE" ? "010-0000-0000" : contactMethod === "KAKAO" ? "카카오톡 ID" : "연락 가능한 정보를 입력하세요"}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">추가 참고 사항 <span className="text-xs font-normal text-muted-foreground">선택</span></Label>
          <Textarea id="notes" name="notes" maxLength={2000} rows={3} placeholder="희망 일정, 반드시 사용해야 하는 도구 등 추가로 전달할 내용을 적어주세요." />
        </div>
      </section>

      {state.error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{state.error}</p> : null}

      <div className="space-y-3 border-t pt-6">
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" />입력한 연락 정보는 구축 상담과 진행 안내에만 사용됩니다.</p>
        <Button type="submit" size="lg" className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700" disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" /> : null}
          {isPending ? "요청 접수 중..." : <>구축 요청 제출 <ArrowRight /></>}
        </Button>
      </div>
    </form>
  );
}
