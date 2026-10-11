"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormMessage } from "@/components/ui/form-message";
import type { Business, BusinessSnsLinks } from "@/types/domain";
import { createBusiness, updateBusiness, type BusinessActionState } from "@/app/(app)/business/actions";
import { mergeBusinessDefault, mergeSnsLinks } from "./prefill";
import {
  EMPTY_PROMOTION_VALUES,
  PromotionFieldInput,
  PromotionHiddenInputs,
  PromotionTypePicker,
  type PromotionValues,
} from "./promotion-fields";
import { PROMOTION_FORM, parsePromotionDetails, type PromotionFieldKey, type PromotionType } from "@/types/promotion";

const initialState: BusinessActionState = {};

/** AI diagnosis suggestions (ticket 2) — only ever used to compute defaultValues below; see src/components/business/prefill.ts. */
export interface BusinessProfilePrefill {
  mainOffering?: string | null;
  strengths?: string | null;
  marketingGoal?: string | null;
  snsLinks?: BusinessSnsLinks;
}

export function BusinessFormDialog({
  business,
  trigger,
  prefill,
  defaultOpen = false,
}: {
  business?: Business;
  trigger: React.ReactNode;
  /** Values a diagnosis suggested — fills a field only when the business doesn't already have one. Never auto-saved: the user still has to submit this form. */
  prefill?: BusinessProfilePrefill;
  defaultOpen?: boolean;
}) {
  const action = business ? updateBusiness.bind(null, business.id) : createBusiness;
  const [state, formAction, isPending] = useActionState(action, initialState);
  const [open, setOpen] = useState(defaultOpen);
  const currentSnsLinks = (business?.sns_links as BusinessSnsLinks | null) ?? null;
  const snsLinks = mergeSnsLinks(currentSnsLinks, prefill?.snsLinks);
  const details = parsePromotionDetails(business?.promotion_details);
  const [type, setType] = useState<PromotionType>(business?.promotion_type ?? "STORE");
  const [values, setValues] = useState<PromotionValues>(() => ({
    ...EMPTY_PROMOTION_VALUES,
    name: business?.name ?? "",
    industry: business?.industry ?? "",
    location: business?.location ?? "",
    mainOffering: mergeBusinessDefault(business?.main_offering, prefill?.mainOffering),
    strengths: mergeBusinessDefault(business?.strengths, prefill?.strengths),
    targetCustomer: business?.target_customer ?? "",
    website: business?.website ?? "",
    problem: details.problem ?? "",
    priceInfo: details.priceInfo ?? "",
    actionUrl: details.actionUrl ?? "",
    flow: details.flow ?? "",
  }));
  const setValue = (key: PromotionFieldKey, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const visibleKeys = PROMOTION_FORM[type].fields.map((spec) => spec.key);
  const hiddenKeys = (Object.keys(values) as PromotionFieldKey[]).filter((key) => !visibleKeys.includes(key));

  useEffect(() => {
    if (!state.success) return;
    toast.success(business ? "사업 정보를 수정했어요." : "사업체를 등록했어요.");
    const closeTimer = window.setTimeout(() => setOpen(false), 0);
    return () => window.clearTimeout(closeTimer);
  }, [business, state]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) setOpen(nextOpen); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{business ? "사업 정보 수정" : "사업체 등록"}</DialogTitle>
          <DialogDescription>무엇을 홍보하는지에 따라 묻는 항목이 달라져요. 적어준 내용만 글과 영상에 사용해요.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4" aria-describedby={state.error ? "business-form-error" : undefined}>
          <PromotionTypePicker value={type} onChange={setType} disabled={isPending} />
          <div className="space-y-4 rounded-xl border bg-muted/30 p-4" aria-live="polite">
            <p className="text-sm font-semibold">{PROMOTION_FORM[type].title} 정보</p>
            <PromotionHiddenInputs values={values} type={type} keys={hiddenKeys} />
            {PROMOTION_FORM[type].fields.map((spec) => (
              <PromotionFieldInput key={spec.key} spec={spec} value={values[spec.key]} onChange={(value) => setValue(spec.key, value)} idPrefix="business" disabled={isPending} />
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">소개</Label>
            <Textarea id="description" name="description" defaultValue={business?.description ?? ""} rows={3} maxLength={2000} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brandTone">브랜드 말투</Label>
            <Input
              id="brandTone"
              name="brandTone"
              placeholder="예: 친근하고 밝게"
              defaultValue={business?.brand_tone ?? ""}
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="keywords">대표 키워드 <span className="font-normal text-muted-foreground">(쉼표로 구분)</span></Label>
            <Input id="keywords" name="keywords" defaultValue={business?.keywords.join(", ") ?? ""} maxLength={500} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="marketingGoal">마케팅 목표</Label>
            <Input
              id="marketingGoal"
              name="marketingGoal"
              placeholder="예: 신규 고객 유입"
              defaultValue={mergeBusinessDefault(business?.marketing_goal, prefill?.marketingGoal)}
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label>SNS 링크</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="Instagram" name="snsLinks.instagram" type="url" placeholder="Instagram" spellCheck={false} defaultValue={snsLinks.instagram ?? ""} maxLength={500} />
              <Input aria-label="Facebook" name="snsLinks.facebook" type="url" placeholder="Facebook" spellCheck={false} defaultValue={snsLinks.facebook ?? ""} maxLength={500} />
              <Input aria-label="YouTube" name="snsLinks.youtube" type="url" placeholder="YouTube" spellCheck={false} defaultValue={snsLinks.youtube ?? ""} maxLength={500} />
              <Input aria-label="네이버 블로그" name="snsLinks.naver_blog" type="url" placeholder="네이버 블로그" spellCheck={false} defaultValue={snsLinks.naver_blog ?? ""} maxLength={500} />
              <Input aria-label="네이버 플레이스" name="snsLinks.naver_place" type="url" placeholder="네이버 플레이스" spellCheck={false} defaultValue={snsLinks.naver_place ?? ""} maxLength={500} />
              <Input aria-label="카카오 채널" name="snsLinks.kakao_channel" type="url" placeholder="카카오 채널" spellCheck={false} defaultValue={snsLinks.kakao_channel ?? ""} maxLength={500} />
            </div>
          </div>
          {state.error ? <FormMessage id="business-form-error">{state.error}</FormMessage> : null}
          <DialogFooter>
            <Button type="submit" disabled={isPending} aria-disabled={isPending}>
              {isPending ? "저장하는 중…" : "저장하기"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
