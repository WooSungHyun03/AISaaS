"use client";

import { useActionState, useState } from "react";
import { createAutomation, type AutomationActionState } from "@/app/(app)/automations/actions";
import { BLOG_DELIVERY_LABEL, type BlogAutomationConfig } from "@/types/blog-automation";
import type { AutomationTemplate, Business } from "@/types/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STEP_LABELS = ["사업체와 목적", "글의 방향", "발행 일정", "저장 위치"];
const WEEKDAYS = [
  { value: 1, label: "월" }, { value: 2, label: "화" }, { value: 3, label: "수" },
  { value: 4, label: "목" }, { value: 5, label: "금" }, { value: 6, label: "토" }, { value: 0, label: "일" },
];

export function BlogSetupWizard({ businesses, template }: { businesses: Business[]; template: AutomationTemplate }) {
  const [state, formAction, isPending] = useActionState<AutomationActionState, FormData>(createAutomation, {});
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [name, setName] = useState(`${businesses[0]?.name ?? "우리 업체"} 블로그 자동화`);
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
    if (currentStep === 0 && (!businessId || !name.trim() || objective.trim().length < 3)) return "사업체, 자동화 이름, 게시 목적을 입력해주세요.";
    if (currentStep === 1 && (!keywords.split(/[,\n]/).some((item) => item.trim()) || tone.trim().length < 2)) return "키워드를 하나 이상 입력하고 글의 톤을 정해주세요.";
    if (currentStep === 2 && (frequency === "WEEKLY" && days.length === 0 || !timeOfDay)) return "실행 요일과 시간을 정해주세요.";
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
    <Card>
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Blog Marketing 설정</span><span>{step + 1} / {STEP_LABELS.length}</span>
        </div>
        <div className="grid grid-cols-4 gap-2" aria-label="설정 진행 상황">
          {STEP_LABELS.map((label, index) => (
            <div key={label} className="space-y-1">
              <div className={`h-1.5 rounded-full ${index <= step ? "bg-primary" : "bg-muted"}`} />
              <span className={`text-xs ${index === step ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
            </div>
          ))}
        </div>
        <CardTitle>{STEP_LABELS[step]}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} onSubmit={(event) => {
          const message = validate(step);
          if (message || step !== 3) { event.preventDefault(); setError(message || "마지막 단계까지 진행해주세요."); }
        }} className="space-y-6">
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
              <select id="blog-business" value={businessId} onChange={(event) => setBusinessId(event.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
              </select>
            </div>
            <div className="space-y-2"><Label htmlFor="blog-name">자동화 이름</Label><Input id="blog-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="예: 우리 업체 블로그 글" /></div>
            <div className="space-y-2"><Label htmlFor="blog-objective">게시 목적 <span className="text-destructive">*</span></Label>
              <textarea id="blog-objective" value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={300} rows={3} placeholder="예: 지역 고객에게 우리 서비스의 장점을 알려 문의를 늘리고 싶어요" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
              <p className="text-xs text-muted-foreground">AI가 주제와 글의 방향을 고를 때 사용합니다.</p>
            </div>
          </div>}

          {step === 1 && <div className="space-y-5">
            <div className="space-y-2"><Label htmlFor="blog-keywords">주요 키워드 <span className="text-destructive">*</span></Label>
              <textarea id="blog-keywords" value={keywords} onChange={(event) => setKeywords(event.target.value)} rows={3} placeholder="예: 강남 필라테스, 체형 교정, 소그룹 수업" className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" />
              <p className="text-xs text-muted-foreground">쉼표나 줄바꿈으로 구분하세요. 최대 12개.</p>
            </div>
            <div className="space-y-2"><Label htmlFor="blog-tone">글의 톤 <span className="text-destructive">*</span></Label>
              <Input id="blog-tone" value={tone} onChange={(event) => setTone(event.target.value)} maxLength={100} placeholder="예: 친근하고 전문적인" />
              <p className="text-xs text-muted-foreground">사업체의 기본 브랜드 톤보다 이 자동화의 톤을 우선합니다.</p>
            </div>
          </div>}

          {step === 2 && <div className="space-y-5">
            <div className="space-y-2"><Label htmlFor="blog-frequency">발행 주기</Label>
              <select id="blog-frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as "DAILY" | "WEEKLY")} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="WEEKLY">선택한 요일마다</option><option value="DAILY">매일</option>
              </select>
            </div>
            {frequency === "WEEKLY" && <div className="space-y-2"><Label>실행 요일</Label><div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((day) => <button type="button" key={day.value} aria-pressed={days.includes(day.value)} onClick={() => setDays((previous) => previous.includes(day.value) ? previous.filter((value) => value !== day.value) : [...previous, day.value])} className={`h-9 w-9 rounded-md border text-sm font-medium ${days.includes(day.value) ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{day.label}</button>)}
            </div></div>}
            <div className="space-y-2"><Label htmlFor="blog-time">실행 시간 (한국 시간)</Label><Input id="blog-time" type="time" value={timeOfDay} onChange={(event) => setTimeOfDay(event.target.value)} /></div>
            <p className="text-sm text-muted-foreground">생성 후 설정을 확인하고 활성화하면 예약 실행이 시작됩니다.</p>
          </div>}

          {step === 3 && <div className="space-y-5">
            <fieldset className="space-y-3"><legend className="text-sm font-medium">글을 어디에 저장할까요?</legend>
              {(Object.keys(BLOG_DELIVERY_LABEL) as BlogAutomationConfig["deliveryMode"][]).map((mode) => <label key={mode} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${deliveryMode === mode ? "border-primary bg-primary/5" : ""}`}>
                <input type="radio" checked={deliveryMode === mode} onChange={() => setDeliveryMode(mode)} className="mt-1" />
                <span><span className="block text-sm font-medium">{BLOG_DELIVERY_LABEL[mode]}</span><span className="block text-xs text-muted-foreground">{mode === "app_draft" ? "WordPress 없이 앱에서 생성된 글을 검토합니다." : mode === "wordpress_draft" ? "WordPress에 비공개 초안으로 저장합니다." : "실행 즉시 공개 게시합니다."}</span></span>
              </label>)}
            </fieldset>
            {needsWordPress && <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">WordPress 연결</p>
              <p className="text-xs text-muted-foreground">WordPress 사용자 프로필에서 Application Password를 만들어 입력하세요. 생성할 때 연결과 권한을 확인합니다.</p>
              <div className="space-y-2"><Label htmlFor="wordpress-site">사이트 주소</Label><Input id="wordpress-site" type="url" value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://example.com" autoComplete="url" /></div>
              <div className="space-y-2"><Label htmlFor="wordpress-user">사용자명</Label><Input id="wordpress-user" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></div>
              <div className="space-y-2"><Label htmlFor="wordpress-password">Application Password</Label><Input id="wordpress-password" type="password" value={appPassword} onChange={(event) => setAppPassword(event.target.value)} autoComplete="new-password" /></div>
            </div>}
            <p className="text-xs text-muted-foreground">비밀번호는 서버에서 암호화해 저장하며 설정 요약에 표시하지 않습니다.</p>
          </div>}

          {(error || state.error) && <p role="alert" className="text-sm text-destructive">{error || state.error}</p>}
          <div className="flex gap-3 border-t pt-5">
            {step > 0 && <Button type="button" variant="outline" onClick={() => { setError(""); setStep((current) => current - 1); }} disabled={isPending}>이전</Button>}
            {step < 3 ? <Button type="button" className="ml-auto" onClick={nextStep}>다음</Button> : <Button type="submit" className="ml-auto" disabled={isPending}>{isPending ? "연결 확인 및 생성 중..." : "자동화 생성 후 설정 확인"}</Button>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
