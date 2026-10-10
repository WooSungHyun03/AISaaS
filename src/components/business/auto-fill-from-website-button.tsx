"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { runDiagnosis, type DiagnosisActionState } from "@/app/(app)/diagnosis/actions";
import { BusinessFormDialog } from "@/components/business/business-form-dialog";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import type { Business } from "@/types/domain";

const initialState: DiagnosisActionState = {};

/**
 * "홈페이지 진단"을 사업 정보 화면용으로 축소한 버전 (ticket 1-5) — 별도
 * URL 입력란이나 점수 화면 없이, 저장된 website로 바로 진단(diagnoseWebsite 재사용)하고
 * 빈 칸만 BusinessFormDialog의 기존 prefill 로직(mergeBusinessDefault/mergeSnsLinks)으로
 * 채워 넣을 수 있는 버튼만 보여준다. 전체 점수/근거 화면은 더 이상 어디에도 없다 —
 * 그게 필요한 흐름(캘린더 만들기 등)은 변하지 않았으니 marketing_diagnoses에는
 * 계속 저장된다(runDiagnosis 그대로 재사용).
 */
export function AutoFillFromWebsiteButton({ business }: { business: Business }) {
  const [state, formAction, isPending] = useActionState(runDiagnosis, initialState);
  const lastResultId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!state.result || state.result.id === lastResultId.current) return;
    lastResultId.current = state.result.id;
    toast.success("홈페이지 진단이 끝났어요. 아래 버튼으로 사업 정보에 채워 넣을 수 있어요.");
  }, [state.result]);

  if (!business.website) {
    return <p className="text-[13px] text-muted-foreground">홈페이지 주소를 등록하면 자동으로 채워 넣을 수 있어요.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="businessId" value={business.id} />
        <input type="hidden" name="url" value={business.website} />
        <Button type="submit" variant="outline" size="sm" disabled={isPending} aria-disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
          {isPending ? "홈페이지 확인하는 중…" : "홈페이지로 자동 채우기"}
        </Button>
      </form>
      {state.result?.profileSuggestions ? (
        <BusinessFormDialog
          business={business}
          prefill={state.result.profileSuggestions}
          trigger={<Button type="button" size="sm">사업 정보에 채워 넣기</Button>}
        />
      ) : null}
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}
    </div>
  );
}
