"use client";

import { useActionState, useState } from "react";
import { createAutomation, type AutomationActionState } from "@/app/(app)/automations/actions";
import type { AutomationTemplate, Business } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { ScheduleFields, ScheduleHiddenInputs, scheduleToValue } from "@/components/automations/schedule-fields";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/ui/form-message";

const STEP_LABELS = ["사업과 목적", "글의 방향", "만들기 주기"];
const STEP_HINTS = [
  "어떤 사업의 어떤 글을 만들지 알려주세요.",
  "AI가 글을 쓸 때 참고할 키워드와 말투예요.",
  "정해진 날에 새 글 초안을 자동으로 만들어 드려요. 이지 마케팅 안에 저장되고, 올리는 건 직접 해요.",
];
const LAST_STEP = STEP_LABELS.length - 1;

export function BlogSetupWizard({ businesses, template }: { businesses: Business[]; template: AutomationTemplate }) {
  const [state, formAction, isPending] = useActionState<AutomationActionState, FormData>(createAutomation, {});
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [name, setName] = useState(`${businesses[0]?.name ?? "우리 업체"} 블로그 글 만들기`);
  const [objective, setObjective] = useState("");
  const [keywords, setKeywords] = useState("");
  const [tone, setTone] = useState("친근하고 전문적인");
  const [schedule, setSchedule] = useState(() => scheduleToValue(null));

  function validate(currentStep: number): string {
    if (currentStep === 0 && (!businessId || !name.trim() || objective.trim().length < 3)) return "사업체, 이름, 글의 목적을 입력해주세요.";
    if (currentStep === 1 && (!keywords.split(/[,\n]/).some((item) => item.trim()) || tone.trim().length < 2)) return "키워드를 하나 이상 입력하고 글의 톤을 정해주세요.";
    if (currentStep === 2 && (schedule.frequency === "WEEKLY" && schedule.daysOfWeek.length === 0 || !schedule.timeOfDay)) return "만들 요일과 시간을 정해주세요.";
    return "";
  }

  function nextStep() {
    const message = validate(step);
    if (message) { setError(message); return; }
    setError("");
    setStep((current) => Math.min(current + 1, LAST_STEP));
  }

  return (
    <div className="rounded-2xl border bg-card">
      <div className="space-y-4 border-b px-5 py-5 sm:px-8">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-primary">블로그 글 만들기 설정</span>
          <span className="tabular text-muted-foreground">{step + 1} / {STEP_LABELS.length}</span>
        </div>
        <Progress value={((step + 1) / STEP_LABELS.length) * 100} aria-label="설정 진행 상황" />
        <ol className="grid grid-cols-3 gap-2 text-[13px]">
          {STEP_LABELS.map((label, index) => (
            <li key={label} aria-current={index === step ? "step" : undefined} className={cn("leading-5", index === step ? "font-bold text-foreground" : "text-muted-foreground")}>
              <span className="hidden sm:inline">{index + 1}. </span>{label}
            </li>
          ))}
        </ol>
      </div>
      <form action={formAction} onSubmit={(event) => {
        const message = validate(step);
        if (message || step !== LAST_STEP) { event.preventDefault(); setError(message || "마지막 단계까지 진행해주세요."); }
      }} className="space-y-6 px-5 py-6 sm:px-8 sm:py-8" aria-describedby={(error || state.error) ? "blog-wizard-error" : undefined}>
        <div>
          <h2 className="text-xl font-extrabold tracking-[-0.03em]">{STEP_LABELS[step]}</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">{STEP_HINTS[step]}</p>
        </div>
        <input type="hidden" name="templateId" value={template.id} />
        <input type="hidden" name="businessId" value={businessId} />
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="objective" value={objective} />
        <input type="hidden" name="keywords" value={keywords} />
        <input type="hidden" name="tone" value={tone} />
        <ScheduleHiddenInputs value={schedule} />
        {/* New blog automations are generation-only — app_draft is the only mode createAutomation accepts, see src/app/(app)/automations/actions.ts */}
        <input type="hidden" name="deliveryMode" value="app_draft" />

        {step === 0 && <div className="space-y-5">
          <div className="space-y-2"><Label htmlFor="blog-business">사업체</Label>
            <NativeSelect id="blog-business" value={businessId} onChange={(event) => setBusinessId(event.target.value)} disabled={isPending}>
              {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-2"><Label htmlFor="blog-name">설정 이름</Label><Input id="blog-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} disabled={isPending} placeholder="예: 우리 가게 블로그 글" /></div>
          <div className="space-y-2"><Label htmlFor="blog-objective">글의 목적 <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Textarea id="blog-objective" value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={300} rows={3} disabled={isPending} placeholder="예: 동네 고객에게 우리 서비스의 장점을 알려 문의를 늘리고 싶어요" />
            <p className="text-[13px] text-muted-foreground">AI가 주제와 글의 방향을 고를 때 참고해요.</p>
          </div>
        </div>}

        {step === 1 && <div className="space-y-5">
          <div className="space-y-2"><Label htmlFor="blog-keywords">주요 키워드 <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Textarea id="blog-keywords" value={keywords} onChange={(event) => setKeywords(event.target.value)} rows={3} maxLength={500} disabled={isPending} placeholder="예: 강남 필라테스, 체형 교정, 소그룹 수업" />
            <p className="text-[13px] text-muted-foreground">쉼표나 줄바꿈으로 나눠 적어주세요. 최대 12개예요.</p>
          </div>
          <div className="space-y-2"><Label htmlFor="blog-tone">글의 말투 <span className="text-destructive" aria-hidden="true">*</span></Label>
            <Input id="blog-tone" value={tone} onChange={(event) => setTone(event.target.value)} maxLength={100} disabled={isPending} placeholder="예: 친근하고 전문적인" />
            <p className="text-[13px] text-muted-foreground">사업체 기본 말투보다 여기서 적은 말투를 먼저 따라요.</p>
          </div>
        </div>}

        {step === 2 && <div className="space-y-5">
          <ScheduleFields idPrefix="blog" value={schedule} onChange={setSchedule} disabled={isPending} />
          <FormMessage variant="info">설정을 만든 뒤 확인하고 켜면 정해진 때마다 글 초안이 만들어져요. 이지 마케팅 안에서 확인하고 복사해 쓰세요.</FormMessage>
        </div>}

        {(error || state.error) && <FormMessage id="blog-wizard-error">{error || state.error}</FormMessage>}
        <div className="flex flex-wrap gap-3 border-t pt-5">
          {step > 0 && <Button key="prev" type="button" variant="outline" onClick={() => { setError(""); setStep((current) => current - 1); }} disabled={isPending}>이전</Button>}
          {step < LAST_STEP ? <Button key="next" type="button" className="ml-auto" onClick={nextStep} disabled={isPending}>다음</Button> : <Button key="submit" type="submit" className="ml-auto" disabled={isPending}>{isPending ? "만드는 중…" : "설정 만들기"}</Button>}
        </div>
      </form>
    </div>
  );
}
