"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { runDiagnosis, type DiagnosisActionState, type DiagnosisResultView } from "@/app/(app)/diagnosis/actions";
import { DiagnosisResult } from "@/components/marketing/diagnosis-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/ui/form-message";
import type { Business } from "@/types/domain";

const initialState: DiagnosisActionState = {};

export function DiagnosisForm({ business, latest = null }: { business: Business; latest?: DiagnosisResultView | null }) {
  const [state, formAction, isPending] = useActionState(runDiagnosis, initialState);
  const lastResultId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!state.result || state.result.id === lastResultId.current) return;
    lastResultId.current = state.result.id;
    toast.success("진단이 끝났어요.");
  }, [state.result]);

  return (
    <div className="space-y-6">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end" aria-describedby={state.error ? "diagnosis-form-error" : undefined}>
        <input type="hidden" name="businessId" value={business.id} />
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="diagnosis-url">홈페이지 주소</Label>
          <Input
            id="diagnosis-url"
            name="url"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://example.com"
            defaultValue={business.website ?? ""}
            required
            disabled={isPending}
          />
        </div>
        <Button type="submit" disabled={isPending} aria-disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          {isPending ? "진단하는 중…" : latest || state.result ? "다시 진단하기" : "진단하기"}
        </Button>
      </form>
      {state.error ? <FormMessage id="diagnosis-form-error">{state.error}</FormMessage> : null}

      {state.result ?? latest ? <DiagnosisResult result={(state.result ?? latest)!} business={business} /> : null}
    </div>
  );
}
