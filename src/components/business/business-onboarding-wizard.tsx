"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Check, MapPin, Palette, Sparkles, UsersRound } from "lucide-react";
import { createBusiness, type BusinessActionState } from "@/app/(app)/business/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const STEPS = [
  { title: "사업체 기본 정보", description: "어떤 사업을 운영하시나요?", icon: Building2 },
  { title: "사업 소개", description: "자동화가 소개할 내용을 알려주세요.", icon: MapPin },
  { title: "타깃 고객", description: "어떤 고객에게 말할까요?", icon: UsersRound },
  { title: "브랜드 스타일", description: "브랜드다운 문장을 만들 준비를 마칩니다.", icon: Palette },
] as const;

const initialValues = {
  name: "",
  industry: "",
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
      setNameError("사업체 이름을 입력해주세요.");
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
      setNameError("사업체 이름을 입력해주세요.");
    }
  }

  const ActiveIcon = STEPS[step].icon;

  return (
    <div className="mx-auto w-full max-w-5xl py-4 md:py-10">
      <div className="mb-8 max-w-2xl">
        <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
          <Sparkles className="size-3.5" /> 시작하기
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-slate-950 md:text-4xl">사업 정보를 알려주세요</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground md:text-base">
          몇 가지 정보만 입력하면 자동화가 내 사업에 맞는 콘텐츠를 만들 수 있습니다. 선택 항목은 나중에 사업체 프로필에서 수정할 수 있어요.
        </p>
      </div>

      <div className="grid overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-slate-50 p-5 lg:border-r lg:border-b-0 lg:p-7">
          <p className="text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">설정 진행 상황</p>
          <ol className="mt-5 grid grid-cols-4 gap-2 lg:grid-cols-1 lg:gap-1">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              return (
                <li key={item.title}>
                  <button
                    type="button"
                    onClick={() => {
                      if (index < step) setStep(index);
                    }}
                    disabled={index > step || isPending}
                    aria-current={index === step ? "step" : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors lg:p-3 ${index === step ? "bg-white text-blue-700 shadow-sm ring-1 ring-blue-100" : index < step ? "text-slate-700 hover:bg-white" : "text-slate-400"}`}
                  >
                    <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${index === step ? "bg-blue-600 text-white" : index < step ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-500"}`}>
                      {index < step ? <Check className="size-4" /> : <Icon className="size-4" />}
                    </span>
                    <span className="hidden text-sm font-medium lg:block">{item.title}</span>
                    <span className="sr-only lg:hidden">{item.title}</span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="mt-8 hidden rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs leading-5 text-blue-900 lg:block">
            <Sparkles className="mb-2 size-4 text-blue-600" />
            입력한 내용은 블로그 글 등 자동화 콘텐츠를 만들 때 참고합니다.
          </div>
        </aside>

        <form action={formAction} onSubmit={handleSubmit} className="flex min-h-[500px] flex-col">
          {Object.entries(values).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}

          <div className="flex-1 p-6 md:p-10">
            <div className="mb-7 flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <ActiveIcon className="size-5" />
              </div>
              <div>
                <p className="text-xs font-semibold text-blue-700">STEP {step + 1} / {STEPS.length}</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950 md:text-2xl">{STEPS[step].title}</h2>
                <p className="mt-1 text-sm text-slate-500">{STEPS[step].description}</p>
              </div>
            </div>

            {step === 0 ? (
              <div className="grid max-w-xl gap-6">
                <div className="space-y-2">
                  <Label htmlFor="onboarding-name">업체명 <span className="text-blue-600">*</span></Label>
                  <Input id="onboarding-name" ref={nameRef} value={values.name} onChange={(event) => setField("name", event.target.value)} placeholder="예: 모닝 베이커리" autoComplete="organization" aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "onboarding-name-error" : undefined} className="h-11" />
                  {nameError ? <p id="onboarding-name-error" role="alert" className="text-sm text-destructive">{nameError}</p> : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="onboarding-industry">업종 <span className="font-normal text-slate-400">선택</span></Label>
                  <Input id="onboarding-industry" value={values.industry} onChange={(event) => setField("industry", event.target.value)} placeholder="예: 카페, 교육, 뷰티" className="h-11" />
                  <p className="text-xs text-slate-500">업종을 입력하면 더 알맞은 표현을 제안하는 데 도움이 됩니다.</p>
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="grid max-w-xl gap-6">
                <div className="space-y-2">
                  <Label htmlFor="onboarding-description">업체 설명 <span className="font-normal text-slate-400">선택</span></Label>
                  <Textarea id="onboarding-description" value={values.description} onChange={(event) => setField("description", event.target.value)} placeholder="어떤 가치를 제공하는지 편하게 적어주세요." rows={4} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="onboarding-services">주요 서비스 · 상품 <span className="font-normal text-slate-400">선택</span></Label>
                  <Input id="onboarding-services" value={values.services} onChange={(event) => setField("services", event.target.value)} placeholder="예: 맞춤 케이크, 단체 주문" className="h-11" />
                  <p className="text-xs text-slate-500">사업체 설명과 함께 저장되어 콘텐츠 작성에 활용됩니다.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="onboarding-location">지역 <span className="font-normal text-slate-400">선택</span></Label>
                  <Input id="onboarding-location" value={values.location} onChange={(event) => setField("location", event.target.value)} placeholder="예: 서울 성수동" className="h-11" />
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="max-w-xl space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="onboarding-target">타깃 고객 <span className="font-normal text-slate-400">선택</span></Label>
                  <Textarea id="onboarding-target" value={values.targetCustomer} onChange={(event) => setField("targetCustomer", event.target.value)} placeholder="예: 성수동에서 선물용 디저트를 찾는 20~30대 직장인" rows={4} />
                </div>
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">잘 모르겠다면 비워두셔도 됩니다. 자동화 설정 후 언제든 구체화할 수 있어요.</p>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="grid max-w-xl gap-6">
                <div className="space-y-2">
                  <Label htmlFor="onboarding-tone">브랜드 톤 <span className="font-normal text-slate-400">선택</span></Label>
                  <Input id="onboarding-tone" value={values.brandTone} onChange={(event) => setField("brandTone", event.target.value)} placeholder="예: 친근하고 밝게, 전문적이고 차분하게" className="h-11" />
                  <div className="flex flex-wrap gap-2 pt-1" aria-label="브랜드 톤 예시">
                    {["친근하고 밝게", "전문적이고 신뢰감 있게", "담백하고 간결하게"].map((tone) => (
                      <button key={tone} type="button" onClick={() => setField("brandTone", tone)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700">{tone}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="onboarding-keywords">키워드 <span className="font-normal text-slate-400">선택</span></Label>
                  <Input id="onboarding-keywords" value={values.keywords} onChange={(event) => setField("keywords", event.target.value)} placeholder="예: 수제 디저트, 성수동, 선물" className="h-11" />
                  <p className="text-xs text-slate-500">여러 개라면 쉼표로 구분해주세요.</p>
                </div>
              </div>
            ) : null}

            {state.error ? <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-destructive">{state.error}</p> : null}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-5 md:px-10">
            <Button type="button" variant="ghost" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0 || isPending} className="h-10">
              <ArrowLeft className="size-4" /> 이전
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={goNext} className="h-10 bg-blue-600 px-5 text-white hover:bg-blue-700">
                다음 <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button type="submit" disabled={isPending} className="h-10 bg-blue-600 px-5 text-white hover:bg-blue-700">
                {isPending ? "저장 중..." : destination === "/automations/marketplace" ? "저장하고 자동화 둘러보기" : "저장하고 요금제 선택하기"} <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </form>
      </div>
      <p className="mt-4 text-center text-xs text-slate-500">필수 항목은 업체명 하나입니다. 나머지는 언제든 추가할 수 있습니다.</p>
    </div>
  );
}
