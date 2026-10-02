"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Globe2 } from "lucide-react";
import { Mascot } from "@/components/brand/mascot";
import { Progress } from "@/components/ui/progress";
import { createBusiness, type BusinessActionState } from "@/app/(app)/business/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/ui/form-message";

const STEPS = [
  { title: "가게 기본 정보", description: "어떤 일을 하시는 가게인가요?" },
  { title: "가게 소개", description: "손님에게 어떻게 소개하고 싶으세요?" },
  { title: "누구에게 말할까요", description: "주로 찾아오는 손님을 떠올려보세요." },
  { title: "말투와 키워드", description: "우리 가게다운 글이 나오도록 알려주세요." },
] as const;

const initialValues = {
  name: "",
  industry: "",
  website: "",
  description: "",
  services: "",
  location: "",
  targetCustomer: "",
  brandTone: "",
  keywords: "",
};

type Field = keyof typeof initialValues;

export function BusinessOnboardingWizard({ destination }: { destination: string }) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [values, setValues] = useState(initialValues);
  const [nameError, setNameError] = useState("");
  const [state, formAction, isPending] = useActionState(createBusiness, {} as BusinessActionState);

  useEffect(() => {
    if (state.success) router.replace(destination);
  }, [destination, router, state.success]);

  function setField(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === "name") setNameError("");
  }

  function goNext() {
    if (step === 0 && !values.name.trim()) {
      setNameError("업체명을 입력해주세요.");
      nameRef.current?.focus();
      return;
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (step < STEPS.length - 1) {
      event.preventDefault();
      goNext();
    } else if (!values.name.trim()) {
      event.preventDefault();
      setStep(0);
      setNameError("업체명을 입력해주세요.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex items-center gap-5 sm:gap-7">
        <Mascot pose="welcome" size={132} priority className="w-[96px] shrink-0 sm:w-[132px]" />
        <div>
          <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-[-0.04em] sm:text-[2rem]">가게를 소개해주세요</h1>
          <p className="mt-2 text-[15px] leading-7 text-muted-foreground">
            적어주신 내용으로 마케팅 진단과 콘텐츠를 가게에 맞게 만들어드려요. 업체명만 있어도 시작할 수 있어요.
          </p>
        </div>
      </div>

      <form action={formAction} onSubmit={handleSubmit} className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
        {Object.entries(values).map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}

        <div className="border-b border-border px-6 pb-5 pt-6 sm:px-10">
          <div className="flex items-center justify-between text-sm">
            <p className="font-semibold text-primary" aria-live="polite">{step + 1} / {STEPS.length} 단계</p>
            <p className="text-muted-foreground">{STEPS[step].description}</p>
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100} className="mt-3" aria-label={`전체 ${STEPS.length}단계 중 ${step + 1}단계`} />
        </div>

        <div className="min-h-[360px] px-6 py-8 sm:px-10">
          <h2 className="mb-6 text-xl font-bold tracking-[-0.03em]">{STEPS[step].title}</h2>

          {step === 0 ? (
            <div className="grid gap-6">
              <div className="space-y-2">
                <Label htmlFor="onboarding-name">업체명 <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only">(필수)</span></Label>
                <Input id="onboarding-name" ref={nameRef} value={values.name} onChange={(event) => setField("name", event.target.value)} placeholder="예: 모닝 베이커리" autoComplete="organization" required maxLength={100} disabled={isPending} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "onboarding-name-error" : undefined} />
                {nameError ? <p id="onboarding-name-error" role="alert" className="text-sm font-medium text-destructive">{nameError}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="onboarding-industry">업종 <span className="font-normal text-muted-foreground">(선택)</span></Label>
                <Input id="onboarding-industry" value={values.industry} onChange={(event) => setField("industry", event.target.value)} placeholder="예: 카페, 학원, 미용실" maxLength={100} disabled={isPending} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="onboarding-website">홈페이지 주소 <span className="font-normal text-muted-foreground">(선택)</span></Label>
                <div className="relative">
                  <Globe2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input id="onboarding-website" type="url" value={values.website} onChange={(event) => setField("website", event.target.value)} placeholder="https://example.com" autoComplete="url" maxLength={500} disabled={isPending} className="pl-10" />
                </div>
                <p className="text-[13px] leading-5 text-muted-foreground">등록한 주소는 마케팅 진단에서 채널 준비 상태를 볼 때 사용해요.</p>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-6">
              <div className="space-y-2">
                <Label htmlFor="onboarding-description">가게 소개 <span className="font-normal text-muted-foreground">(선택)</span></Label>
                <Textarea id="onboarding-description" value={values.description} onChange={(event) => setField("description", event.target.value)} placeholder="어떤 가게이고, 무엇이 특별한지 편하게 적어주세요." rows={4} maxLength={2000} disabled={isPending} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="onboarding-services">주요 상품·서비스 <span className="font-normal text-muted-foreground">(선택)</span></Label>
                <Input id="onboarding-services" value={values.services} onChange={(event) => setField("services", event.target.value)} placeholder="예: 맞춤 케이크, 단체 주문" maxLength={400} disabled={isPending} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="onboarding-location">지역 <span className="font-normal text-muted-foreground">(선택)</span></Label>
                <Input id="onboarding-location" value={values.location} onChange={(event) => setField("location", event.target.value)} placeholder="예: 서울 성수동" maxLength={200} disabled={isPending} />
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="onboarding-target">주요 손님 <span className="font-normal text-muted-foreground">(선택)</span></Label>
                <Textarea id="onboarding-target" value={values.targetCustomer} onChange={(event) => setField("targetCustomer", event.target.value)} placeholder="예: 성수동에서 선물용 디저트를 찾는 20~30대 직장인" rows={4} maxLength={500} disabled={isPending} />
              </div>
              <p className="rounded-lg bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">잘 모르겠으면 비워두셔도 돼요. 나중에 사업 정보에서 언제든 고칠 수 있어요.</p>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-6">
              <div className="space-y-2">
                <Label htmlFor="onboarding-tone">브랜드 말투 <span className="font-normal text-muted-foreground">(선택)</span></Label>
                <Input id="onboarding-tone" value={values.brandTone} onChange={(event) => setField("brandTone", event.target.value)} placeholder="예: 친근하고 밝게, 전문적이고 차분하게" maxLength={200} disabled={isPending} />
                <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label="브랜드 말투 예시">
                  {["친근하고 밝게", "전문적이고 신뢰감 있게", "담백하고 간결하게"].map((tone) => (
                    <button key={tone} type="button" onClick={() => setField("brandTone", tone)} disabled={isPending} className="min-h-9 cursor-pointer rounded-full border border-input bg-card px-3.5 text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-brand-soft hover:text-primary disabled:opacity-50">{tone}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="onboarding-keywords">대표 키워드 <span className="font-normal text-muted-foreground">(선택)</span></Label>
                <Input id="onboarding-keywords" value={values.keywords} onChange={(event) => setField("keywords", event.target.value)} placeholder="예: 수제 디저트, 성수동, 선물" maxLength={500} disabled={isPending} />
                <p className="text-[13px] text-muted-foreground">여러 개라면 쉼표(,)로 구분해주세요.</p>
              </div>
            </div>
          ) : null}

          {state.error ? <FormMessage className="mt-6">{state.error}</FormMessage> : null}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border bg-muted/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <Button type="button" variant="ghost" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || isPending}>
            <ArrowLeft aria-hidden="true" /> 이전
          </Button>
          {step < STEPS.length - 1 ? (
            <Button key="next" type="button" onClick={goNext} disabled={isPending}>
              다음 <ArrowRight aria-hidden="true" />
            </Button>
          ) : (
            <Button key="submit" type="submit" disabled={isPending}>
              {isPending ? "저장하는 중…" : destination === "/automations/marketplace" ? "저장하고 콘텐츠 만들러 가기" : "저장하고 요금제 선택하기"} <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
