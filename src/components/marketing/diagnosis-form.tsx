"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { runDiagnosis, type DiagnosisActionState } from "@/app/(app)/diagnosis/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/ui/form-message";
import { ScoreRing, scoreTone } from "@/components/marketing/score-ring";

const initialState: DiagnosisActionState = {};

export function DiagnosisForm({ businessId, defaultUrl }: { businessId: string; defaultUrl?: string | null }) {
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
        <input type="hidden" name="businessId" value={businessId} />
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
            defaultValue={defaultUrl ?? ""}
            required
            disabled={isPending}
          />
        </div>
        <Button type="submit" disabled={isPending} aria-disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          {isPending ? "진단하는 중…" : "진단하기"}
        </Button>
      </form>
      {state.error ? <FormMessage id="diagnosis-form-error">{state.error}</FormMessage> : null}

      {state.result ? <DiagnosisResultCard result={state.result} /> : null}
    </div>
  );
}

function DiagnosisResultCard({ result }: { result: NonNullable<DiagnosisActionState["result"]> }) {
  const tone = scoreTone(result.score);
  return (
    <section aria-label="진단 결과" className="rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <ScoreRing score={result.score} size={128} />
        <div className="min-w-0 flex-1 space-y-4 text-center sm:text-left">
          <p className={`text-lg font-bold tracking-[-0.02em] ${tone.text}`}>{tone.label}</p>
          <dl className="space-y-2 text-[15px] leading-6">
            <div>
              <dt className="font-semibold text-muted-foreground">콘텐츠 상태</dt>
              <dd>{result.contentStatus}</dd>
            </div>
            <div>
              <dt className="font-semibold text-muted-foreground">SNS 활동</dt>
              <dd>{result.snsActivity}</dd>
            </div>
            {result.missingChannels.length ? (
              <div>
                <dt className="font-semibold text-muted-foreground">비어 있는 채널</dt>
                <dd>{result.missingChannels.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
          {result.recommendations.length ? (
            <div>
              <p className="font-semibold text-muted-foreground">추천 액션</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px] leading-6">
                {result.recommendations.map((recommendation, index) => (
                  <li key={index}>{recommendation}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
