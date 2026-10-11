"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Mascot } from "@/components/brand/mascot";
import { Progress } from "@/components/ui/progress";
import { createBusiness, type BusinessActionState } from "@/app/(app)/business/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/ui/form-message";
import { EMPTY_PROMOTION_VALUES, PromotionFieldInput, PromotionHiddenInputs, PromotionTypePicker } from "@/components/business/promotion-fields";
import { PROMOTION_FORM, type PromotionFieldKey, type PromotionType } from "@/types/promotion";

const STEPS = [
  { title: "무엇을 홍보하시나요?", description: "가게, 상품, 플랫폼 중에서 골라주세요." },
  { title: "기본 정보", description: "이름과 핵심 정보를 알려주세요." },
  { title: "자세한 정보", description: "글과 영상에 들어갈 내용이에요." },
  { title: "소개와 말투", description: "우리다운 글이 나오도록 알려주세요." },
] as const;

const initialValues = { ...EMPTY_PROMOTION_VALUES, description: "", brandTone: "", keywords: "" };
type Values = typeof initialValues;
type Field = keyof Values;

export function BusinessOnboardingWizard({ destination }: { destination: string }) {
  const router = useRouter();
    const [step, setStep] = useState(0);
  const [type, setType] = useState<PromotionType>("STORE");
  const [values, setValues] = useState<Values>(initialValues);
  const [nameError, setNameError] = useState("");
  const [state, formAction, isPending] = useActionState(createBusiness, {} as BusinessActionState);

  useEffect(() => {
    if (state.success) router.replace(destination);
  }, [destination, router, state.success]);

  function setField(field: Field | PromotionFieldKey, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === "name") setNameError("");
  }

  const fields = PROMOTION_FORM[type].fields;
  const nameLabel = fields.find((spec) => spec.key === "name")?.label ?? "이름";

  function goNext() {
    if (step === 1 && !values.name.trim()) {
      setNameError(`${nameLabel}을(를) 입력해주세요.`);
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
      setStep(1);
      setNameError(`${nameLabel}을(를) 입력해주세요.`);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex items-center gap-5 sm:gap-7">
        <Mascot pose="welcome" size={132} priority className="w-[96px] shrink-0 sm:w-[132px]" />
        <div>
          <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-[-0.04em] sm:text-[2rem]">홍보할 대상을 알려주세요</h1>
          <p className="mt-2 text-[15px] leading-7 text-muted-foreground">
            가게·상품·플랫폼에 따라 묻는 내용과 만드는 글·영상이 달라져요. 이름만 있어도 시작할 수 있어요.
          </p>
        </div>
      </div>

      <form action={formAction} onSubmit={handleSubmit} className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
        <PromotionHiddenInputs values={values} type={type} />
        <input type="hidden" name="description" value={values.description} />
        <input type="hidden" name="brandTone" value={values.brandTone} />
        <input type="hidden" name="keywords" value={values.keywords} />

        <div className="border-b border-border px-6 pb-5 pt-6 sm:px-10">
          <div className="flex items-center justify-between text-sm">
            <p className="font-semibold text-primary" aria-live="polite">{step + 1} / {STEPS.length} 단계</p>
            <p className="text-muted-foreground">{STEPS[step].description}</p>
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100} className="mt-3" aria-label={`전체 ${STEPS.length}단계 중 ${step + 1}단계`} />
        </div>

        <div className="min-h-[360px] px-6 py-8 sm:px-10">
          <h2 className="mb-6 text-xl font-bold tracking-[-0.03em]">{STEPS[step].title}</h2>

          {step === 0 ? <PromotionTypePicker value={type} onChange={setType} disabled={isPending} /> : null}

          {step === 1 || step === 2 ? (
            <div className="grid gap-6">
              {(step === 1 ? fields.slice(0, 3) : fields.slice(3)).map((spec) => (
                <div key={spec.key} className="space-y-2">
                  <PromotionFieldInput spec={spec} value={values[spec.key]} onChange={(value) => setField(spec.key, value)} idPrefix="onboarding" disabled={isPending} />
                  {spec.key === "name" && nameError ? <p role="alert" className="text-sm font-medium text-destructive">{nameError}</p> : null}
                </div>
              ))}
              {step === 2 ? <p className="rounded-lg bg-muted px-4 py-3 text-sm leading-6 text-muted-foreground">잘 모르겠으면 비워두셔도 돼요. 적어주신 내용만 글과 영상에 쓰고, 없는 내용은 지어내지 않아요. 나중에 사업 정보에서 언제든 고칠 수 있어요.</p> : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-6">
              <div className="space-y-2">
                <Label htmlFor="onboarding-description">소개 <span className="font-normal text-muted-foreground">(선택)</span></Label>
                <Textarea id="onboarding-description" value={values.description} onChange={(event) => setField("description", event.target.value)} placeholder="어떤 곳이고, 무엇이 특별한지 편하게 적어주세요." rows={4} maxLength={2000} disabled={isPending} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="onboarding-tone">말투 <span className="font-normal text-muted-foreground">(선택)</span></Label>
                <Input id="onboarding-tone" value={values.brandTone} onChange={(event) => setField("brandTone", event.target.value)} placeholder="예: 친근하고 밝게, 전문적이고 차분하게" maxLength={200} disabled={isPending} />
                <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label="말투 예시">
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
              {isPending ? "저장하는 중…" : destination === "/marketing/diagnosis" ? "저장하고 마케팅 진단 받으러 가기" : "저장하고 이어서 진행하기"} <ArrowRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
