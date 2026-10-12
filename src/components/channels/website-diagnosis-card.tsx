"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ChevronDown, CircleAlert, Loader2, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { runDiagnosis, type DiagnosisActionState } from "@/app/(app)/diagnosis/actions";
import { ScoreRing, scoreTone } from "@/components/marketing/score-ring";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GROUP_LABEL, type ScoreItem } from "@/server/marketing/scoring";

export interface StoredWebsiteDiagnosis {
  score: number;
  scoreBreakdown: ScoreItem[];
  recommendations: string[];
  contentStatus: string | null;
  sourceUrl: string | null;
  createdAt: string | null;
}

const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
const initialState: DiagnosisActionState = {};

const SUMMARY_RECOMMENDATIONS = 3;

/** One row per score group: points earned out of the points available. */
export function summarizeGroups(items: ScoreItem[]) {
  return Object.entries(GROUP_LABEL)
    .map(([group, label]) => {
      const inGroup = items.filter((item) => item.group === group);
      return { group, label, points: inGroup.reduce((sum, item) => sum + item.points, 0), max: inGroup.reduce((sum, item) => sum + item.max, 0) };
    })
    .filter((entry) => entry.max > 0);
}

function GroupSummary({ items }: { items: ScoreItem[] }) {
  const groups = summarizeGroups(items);
  return (
    <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2" aria-label="영역별 점수">
      {groups.map((entry) => {
        const percent = Math.round((entry.points / entry.max) * 100);
        return (
          <li key={entry.group}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold">{entry.label}</span>
              <span className="tabular font-bold">{entry.points}<span className="font-medium text-muted-foreground"> / {entry.max}</span></span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

function Breakdown({ items }: { items: ScoreItem[] }) {
  const groups = Object.entries(GROUP_LABEL).map(([group, label]) => ({ group, label, items: items.filter((item) => item.group === group) })).filter((entry) => entry.items.length > 0);
  return (
    <div className="space-y-5">
      {groups.map((entry) => (
        <section key={entry.group} aria-label={entry.label}>
          <h4 className="text-sm font-semibold">{entry.label}</h4>
          <ul className="mt-2 divide-y rounded-xl border">
            {entry.items.map((item) => (
              <li key={item.key} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{item.label}</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{item.detail}</p>
                </div>
                <p className="tabular shrink-0 text-sm font-bold">{item.points}<span className="font-medium text-muted-foreground"> / {item.max}</span></p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Homepage diagnosis. The score is computed in code from what was measured on the page (never by the AI) and every
 * point comes with the sentence that explains it, so the owner can see exactly what to fix.
 */
export function WebsiteDiagnosisCard({ businessId, website, stored }: { businessId: string; website: string | null; stored: StoredWebsiteDiagnosis | null }) {
  const [state, formAction, isPending] = useActionState(runDiagnosis, initialState);
  const lastResultId = useRef<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!state.result || state.result.id === lastResultId.current) return;
    lastResultId.current = state.result.id;
    toast.success("홈페이지를 진단했어요.");
  }, [state.result]);

  const view = state.result
    ? { score: state.result.score, scoreBreakdown: state.result.scoreBreakdown, recommendations: state.result.recommendations, contentStatus: state.result.contentStatus, sourceUrl: state.result.sourceUrl, createdAt: state.result.createdAt }
    : stored;
  const tone = view ? scoreTone(view.score) : null;

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-5">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="businessId" value={businessId} />
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="website-url">홈페이지 주소</Label>
          <Input id="website-url" name="url" type="url" inputMode="url" defaultValue={website ?? ""} placeholder="https://내가게.com" required disabled={isPending} />
        </div>
        <Button type="submit" disabled={isPending} aria-disabled={isPending}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ScanSearch aria-hidden="true" />}
          {isPending ? "진단하는 중…" : view ? "다시 진단하기" : "홈페이지 진단하기"}
        </Button>
      </form>
      {state.error ? <FormMessage>{state.error}</FormMessage> : null}

      {view && tone ? (
        <div className="space-y-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <ScoreRing score={view.score} size={120} />
            <div className="min-w-0 space-y-1">
              <p className={`text-lg font-extrabold tracking-[-0.03em] ${tone.text}`}>{tone.label}</p>
              {view.sourceUrl ? <p className="break-all text-[13px] text-muted-foreground">{view.sourceUrl}</p> : null}
              {view.createdAt ? <p className="text-[13px] text-muted-foreground">{dateFormat.format(new Date(view.createdAt))}에 진단했어요 (한국 시간)</p> : null}
              {view.contentStatus ? <p className="pt-1 text-[15px] leading-7">{view.contentStatus}</p> : null}
            </div>
          </div>
          {view.scoreBreakdown.length > 0 ? <GroupSummary items={view.scoreBreakdown} /> : null}
          {view.recommendations.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold">먼저 해볼 일</h4>
              <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[14px] leading-6">
                {view.recommendations.slice(0, SUMMARY_RECOMMENDATIONS).map((recommendation, index) => <li key={index}>{recommendation}</li>)}
              </ol>
            </div>
          ) : null}
          {view.scoreBreakdown.length > 0 || view.recommendations.length > SUMMARY_RECOMMENDATIONS ? (
            <div>
              <Button type="button" variant="outline" size="sm" aria-expanded={expanded} aria-controls="website-diagnosis-detail" onClick={() => setExpanded((value) => !value)}>
                {expanded ? "접기" : "자세히 보기"}
                <ChevronDown className={expanded ? "rotate-180" : undefined} aria-hidden="true" />
              </Button>
              {expanded ? (
                <div id="website-diagnosis-detail" className="mt-5 space-y-5">
                  {view.scoreBreakdown.length > 0 ? <Breakdown items={view.scoreBreakdown} /> : null}
                  {view.recommendations.length > SUMMARY_RECOMMENDATIONS ? (
                    <div>
                      <h4 className="text-sm font-semibold">그 밖에 해볼 일</h4>
                      <ol start={SUMMARY_RECOMMENDATIONS + 1} className="mt-1.5 list-decimal space-y-1 pl-5 text-[14px] leading-6">
                        {view.recommendations.slice(SUMMARY_RECOMMENDATIONS).map((recommendation, index) => <li key={index}>{recommendation}</li>)}
                      </ol>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <p className="flex items-start gap-2 text-[13px] leading-5 text-muted-foreground"><CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />점수는 홈페이지에서 실제로 확인한 항목만으로 계산해요. 방문자 수 같은 외부 수치는 확인할 수 없어 반영하지 않아요.</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">홈페이지 주소를 넣으면 기본 설정·콘텐츠·연락 방법·채널 연결·최근 업데이트를 항목별로 점검해드려요.</p>
      )}
    </div>
  );
}
