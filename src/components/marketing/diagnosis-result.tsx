"use client";

import Link from "next/link";
import { ArrowRight, Check, CircleAlert, Sparkles } from "lucide-react";
import type { DiagnosisResultView } from "@/app/(app)/diagnosis/actions";
import { BusinessFormDialog } from "@/components/business/business-form-dialog";
import { ScoreRing, scoreTone } from "@/components/marketing/score-ring";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { GROUP_LABEL, type ScoreItem } from "@/server/marketing/scoring";
import type { Business } from "@/types/domain";

const SUGGESTION_LABEL: Record<string, string> = {
  mainOffering: "주요 상품·서비스",
  strengths: "강점",
  marketingGoal: "마케팅 목표",
};

function groupItems(items: ScoreItem[]) {
  const groups = new Map<ScoreItem["group"], ScoreItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return Array.from(groups.entries()).map(([group, entries]) => ({
    group,
    label: GROUP_LABEL[group],
    points: entries.reduce((total, entry) => total + entry.points, 0),
    max: entries.reduce((total, entry) => total + entry.max, 0),
    entries,
  }));
}

/** 홈페이지 진단 결과: 점수, 점수 근거(항목별 이유), 추천, 프로필 제안(근거 포함). */
export function DiagnosisResult({ result, business }: { result: DiagnosisResultView; business: Business }) {
  const { profileSuggestions } = result;
  const suggestionEntries = (["mainOffering", "strengths", "marketingGoal"] as const).flatMap((key) => {
    const value = profileSuggestions?.[key];
    return value ? [{ key, value, evidence: (result.evidence[key] as string | undefined) ?? null }] : [];
  });
  const hasProfileSuggestions =
    suggestionEntries.length > 0 || Object.values(profileSuggestions?.snsLinks ?? {}).some(Boolean);
  const tone = scoreTone(result.score);
  const groups = groupItems(result.scoreBreakdown);

  return (
    <section aria-label="홈페이지 진단 결과" className="space-y-6 rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <ScoreRing score={result.score} size={128} />
        <div className="min-w-0 flex-1 space-y-4 text-center sm:text-left">
          <div>
            <p className={`text-lg font-bold tracking-[-0.02em] ${tone.text}`}>홈페이지 점수 · {tone.label}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {result.sourceUrl ? <span className="break-all">{result.sourceUrl}</span> : null}
              {result.createdAt ? ` · ${new Date(result.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 진단` : null}
            </p>
          </div>
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
                <dt className="font-semibold text-muted-foreground">아직 없는 채널</dt>
                <dd>{result.missingChannels.join(", ")}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>

      {groups.length > 0 ? (
        <div>
          <h3 className="text-[15px] font-bold">점수는 이렇게 계산했어요</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">홈페이지에서 직접 확인한 항목만 점수에 넣었어요. AI가 점수를 정하지 않아요.</p>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {groups.map((group) => (
              <li key={group.group} className="py-3">
                <div className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-sm font-semibold">{group.label}</p>
                  <Progress value={(group.points / group.max) * 100} className="hidden h-1.5 w-28 sm:flex" aria-label={`${group.label} ${group.max}점 중 ${group.points}점`} />
                  <span className="tabular w-14 shrink-0 text-right text-sm font-bold">{group.points}<span className="font-medium text-muted-foreground">/{group.max}</span></span>
                </div>
                <ul className="mt-2 space-y-1">
                  {group.entries.map((entry) => (
                    <li key={entry.key} className="flex items-start gap-2 text-[13px] leading-5 text-muted-foreground">
                      {entry.points >= entry.max
                        ? <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-label="충족" />
                        : <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-label="보완 필요" />}
                      <span><span className="font-semibold text-foreground">{entry.label}</span> {entry.points}/{entry.max} · {entry.detail}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.recommendations.length ? (
        <div>
          <h3 className="text-[15px] font-bold">먼저 해볼 일</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] leading-6">
            {result.recommendations.map((recommendation, index) => (
              <li key={index}>{recommendation}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {hasProfileSuggestions && profileSuggestions ? (
        <div className="rounded-xl bg-brand-soft p-4">
          <h3 className="text-[15px] font-bold">사업 정보에 넣어볼 만한 내용</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">홈페이지에 적힌 문구를 근거로 찾은 것만 보여드려요. 확인하고 고친 뒤 직접 저장해야 반영돼요.</p>
          {suggestionEntries.length ? (
            <dl className="mt-3 space-y-2 text-sm">
              {suggestionEntries.map((entry) => (
                <div key={entry.key}>
                  <dt className="font-semibold">{SUGGESTION_LABEL[entry.key]}</dt>
                  <dd>{entry.value}</dd>
                  {entry.evidence ? <dd className="text-[13px] text-muted-foreground">근거: “{entry.evidence}”</dd> : null}
                </div>
              ))}
            </dl>
          ) : null}
          <div className="mt-3">
            <BusinessFormDialog
              business={business}
              prefill={profileSuggestions}
              trigger={
                <Button type="button" variant="outline">
                  <Sparkles aria-hidden="true" /> 사업 정보에 채워 넣기
                </Button>
              }
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t pt-5">
        <Button asChild>
          <Link href={`/calendar?business=${business.id}`}>이 진단으로 마케팅 캘린더 만들기 <ArrowRight aria-hidden="true" /></Link>
        </Button>
        <p className="text-[13px] text-muted-foreground">진단 결과와 사업 정보를 바탕으로 2~4주 콘텐츠 계획을 짜 드려요.</p>
      </div>
    </section>
  );
}
