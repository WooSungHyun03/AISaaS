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
          <DialogDescription>진단과 콘텐츠를 만들 때 AI가 참고하는 정보예요.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4" aria-describedby={state.error ? "business-form-error" : undefined}>
          <div className="space-y-2">
            <Label htmlFor="name">업체명 <span className="text-destructive" aria-hidden="true">*</span><span className="sr-only">(필수)</span></Label>
            <Input id="name" name="name" defaultValue={business?.name} required maxLength={100} aria-invalid={Boolean(state.error)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="industry">업종</Label>
              <Input id="industry" name="industry" defaultValue={business?.industry ?? ""} maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">지역</Label>
              <Input id="location" name="location" defaultValue={business?.location ?? ""} maxLength={200} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">가게 소개</Label>
            <Textarea id="description" name="description" defaultValue={business?.description ?? ""} rows={3} maxLength={2000} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="targetCustomer">주요 손님</Label>
            <Input id="targetCustomer" name="targetCustomer" defaultValue={business?.target_customer ?? ""} maxLength={500} />
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
            <Label htmlFor="website">홈페이지</Label>
            <Input id="website" name="website" type="url" autoComplete="url" spellCheck={false} defaultValue={business?.website ?? ""} maxLength={500} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mainOffering">주요 상품/서비스</Label>
            <Textarea
              id="mainOffering"
              name="mainOffering"
              rows={2}
              defaultValue={mergeBusinessDefault(business?.main_offering, prefill?.mainOffering)}
              maxLength={300}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="strengths">강점</Label>
            <Textarea
              id="strengths"
              name="strengths"
              rows={2}
              defaultValue={mergeBusinessDefault(business?.strengths, prefill?.strengths)}
              maxLength={300}
            />
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
