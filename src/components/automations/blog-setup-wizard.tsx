"use client";

import { useActionState, useState } from "react";
import { createAutomation, type AutomationActionState } from "@/app/(app)/automations/actions";
import { BLOG_DELIVERY_LABEL, type BlogAutomationConfig } from "@/types/blog-automation";
import type { AutomationTemplate, Business } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { WeekdayPicker } from "@/components/automations/weekday-picker";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/ui/form-message";

const STEP_LABELS = ["사업과 목적", "글의 방향", "만들기 주기", "저장 위치"];
const STEP_HINTS = [
  "어떤 사업의 어떤 글을 만들지 알려주세요.",
  "AI가 글을 쓸 때 참고할 키워드와 말투예요.",
  "정해진 날에 새 글 초안을 자동으로 만들어 드려요. 올리는 건 직접 해요.",
  "만든 글을 어디에 모아둘지 골라주세요.",
];
const DELIVERY_HINT: Record<BlogAutomationConfig["deliveryMode"], string> = {
  app_draft: "이지 마케팅 안에서 글을 확인하고 복사해 쓰세요. 가장 간단해요.",
  wordpress_draft: "내 WordPress에 비공개 초안으로 넣어 드려요. 공개는 직접 하세요.",
  wordpress_publish: "WordPress 연결이 있는 경우에만. 만들어진 글이 바로 공개되니 신중히 고르세요.",
};

export function BlogSetupWizard({ businesses, template }: { businesses: Business[]; template: AutomationTemplate }) {
  const [state, formAction, isPending] = useActionState<AutomationActionState, FormData>(createAutomation, {});
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [name, setName] = useState(`${businesses[0]?.name ?? "우리 업체"} 블로그 글 만들기`);
  const [objective, setObjective] = useState("");
  const [keywords, setKeywords] = useState("");
  const [tone, setTone] = useState("친근하고 전문적인");
  const [frequency, setFrequency] = useState<"DAILY" | "WEEKLY">("WEEKLY");
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [deliveryMode, setDeliveryMode] = useState<BlogAutomationConfig["deliveryMode"]>("app_draft");
  const [siteUrl, setSiteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const needsWordPress = deliveryMode !== "app_draft";

  function validate(currentStep: number): string {
    if (currentStep === 0 && (!businessId || !name.trim() || objective.trim().length < 3)) return "사업체, 이름, 글의 목적을 입력해주세요.";
    if (currentStep === 1 && (!keywords.split(/[,\n]/).some((item) => item.trim()) || tone.trim().length < 2)) return "키워드를 하나 이상 입력하고 글의 톤을 정해주세요.";
    if (currentStep === 2 && (frequency === "WEEKLY" && days.length === 0 || !timeOfDay)) return "만들 요일과 시간을 정해주세요.";
    if (currentStep === 3 && needsWordPress && (!siteUrl.trim() || !username.trim() || !appPassword.trim())) return "WordPress 사이트 주소, 사용자명, Application Password를 입력해주세요.";
    return "";
  }

  function nextStep() {
    const message = validate(step);
    if (message) { setError(message); return; }
    setError("");
    setStep((current) => Math.min(current + 1, STEP_LABELS.length - 1));
  }

  return (
    <div className="rounded-2xl border bg-card">
      <div className="space-y-4 border-b px-5 py-5 sm:px-8">
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold text-primary">블로그 글 만들기 설정</span>
          <span className="tabular text-muted-foreground">{step + 1} / {STEP_LABELS.length}</span>
        </div>
        <Progress value={((step + 1) / STEP_LABELS.length) * 100} aria-label="설정 진행 상황" />
        <ol className="grid grid-cols-4 gap-2 text-[13px]">
          {STEP_LABELS.map((label, index) => (
            <li key={label} aria-current={index === step ? "step" : undefined} className={cn("leading-5", index === step ? "font-bold text-foreground" : "text-muted-foreground")}>
              <span className="hidden sm:inline">{index + 1}. </span>{label}
            </li>
          ))}
        </ol>
      </div>
      <form action={formAction} onSubmit={(event) => {
        const message = validate(step);
        if (message || step !== 3) { event.preventDefault(); setError(message || "마지막 단계까지 진행해주세요."); }
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
        <input type="hidden" name="frequency" value={frequency} />
        <input type="hidden" name="timeOfDay" value={timeOfDay} />
        {frequency === "WEEKLY" && days.map((day) => <input key={day} type="hidden" name="daysOfWeek" value={day} />)}
        <input type="hidden" name="deliveryMode" value={deliveryMode} />
        {needsWordPress && <>
          <input type="hidden" name="wordpressSiteUrl" value={siteUrl} />
          <input type="hidden" name="wordpressUsername" value={username} />
          <input type="hidden" name="wordpressAppPassword" value={appPassword} />
        </>}

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
          <div className="space-y-2"><Label htmlFor="blog-frequency">만드는 주기</Label>
            <NativeSelect id="blog-frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as "DAILY" | "WEEKLY")} disabled={isPending}>
              <option value="WEEKLY">정한 요일마다</option><option value="DAILY">매일</option>
            </NativeSelect>
          </div>
          {frequency === "WEEKLY" && <WeekdayPicker legend="만드는 요일" value={days} onChange={setDays} disabled={isPending} />}
          <div className="space-y-2"><Label htmlFor="blog-time">만드는 시간 (한국 시간)</Label><Input id="blog-time" type="time" value={timeOfDay} onChange={(event) => setTimeOfDay(event.target.value)} disabled={isPending} className="sm:w-44" /></div>
          <FormMessage variant="info">설정을 만든 뒤 확인하고 켜면 정해진 때마다 글 초안이 만들어져요.</FormMessage>
        </div>}

        {step === 3 && <div className="space-y-5">
          <fieldset className="space-y-3"><legend className="text-sm font-semibold">만든 글을 어디에 저장할까요?</legend>
            {(Object.keys(BLOG_DELIVERY_LABEL) as BlogAutomationConfig["deliveryMode"][]).map((mode) => <label key={mode} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:ring-3 focus-within:ring-ring/25", deliveryMode === mode ? "border-primary bg-brand-soft" : "hover:border-primary/40")}>
              <input type="radio" name="delivery-mode-option" value={mode} checked={deliveryMode === mode} onChange={() => setDeliveryMode(mode)} disabled={isPending} className="mt-1.5 size-4 accent-primary" />
              <span className="min-w-0"><span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">{BLOG_DELIVERY_LABEL[mode]}{mode === "app_draft" ? <Badge variant="brand">추천</Badge> : null}</span><span className="mt-0.5 block text-[13px] leading-6 text-muted-foreground">{DELIVERY_HINT[mode]}</span></span>
            </label>)}
          </fieldset>
          {needsWordPress && <div className="space-y-4 rounded-xl bg-muted p-4 sm:p-5">
            <div><p className="text-sm font-semibold">WordPress 연결</p>
              <p className="mt-1 text-[13px] leading-6 text-muted-foreground">WordPress 사용자 프로필에서 Application Password를 만들어 입력하세요. 만들 때 연결과 권한을 확인해요.</p></div>
            <div className="space-y-2"><Label htmlFor="wordpress-site">사이트 주소</Label><Input id="wordpress-site" type="url" value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://example.com" autoComplete="url" disabled={isPending} /></div>
            <div className="space-y-2"><Label htmlFor="wordpress-user">사용자명</Label><Input id="wordpress-user" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" disabled={isPending} /></div>
            <div className="space-y-2"><Label htmlFor="wordpress-password">Application Password</Label><Input id="wordpress-password" type="password" value={appPassword} onChange={(event) => setAppPassword(event.target.value)} autoComplete="new-password" disabled={isPending} /></div>
            <p className="text-[13px] text-muted-foreground">비밀번호는 서버에서 암호화해 저장하고, 설정 요약에는 보여주지 않아요.</p>
          </div>}
        </div>}

        {(error || state.error) && <FormMessage id="blog-wizard-error">{error || state.error}</FormMessage>}
        <div className="flex flex-wrap gap-3 border-t pt-5">
          {step > 0 && <Button key="prev" type="button" variant="outline" onClick={() => { setError(""); setStep((current) => current - 1); }} disabled={isPending}>이전</Button>}
          {step < 3 ? <Button key="next" type="button" className="ml-auto" onClick={nextStep} disabled={isPending}>다음</Button> : <Button key="submit" type="submit" className="ml-auto" disabled={isPending}>{isPending ? "연결 확인하고 만드는 중…" : "설정 만들기"}</Button>}
        </div>
      </form>
    </div>
  );
}
