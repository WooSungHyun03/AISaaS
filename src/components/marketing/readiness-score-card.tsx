import Link from "next/link";
import { ArrowRight, Check, CircleAlert } from "lucide-react";
import { Mascot } from "@/components/brand/mascot";
import { ScoreRing, scoreTone } from "@/components/marketing/score-ring";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ReadinessScoreResult } from "@/server/marketing/readiness";

/**
 * "마케팅 운영 준비 점수" 카드 — ticket 1-5: /marketing/diagnosis에 있던 점수
 * 링/체크리스트 UI를 그대로 /diagnosis 상단으로 옮긴 것. 계산은
 * src/server/marketing/readiness.ts의 getReadinessScore가 하고, 이 컴포넌트는
 * 그 결과를 받아 그리기만 한다 — Supabase를 직접 조회하지 않는다.
 */
export function ReadinessScoreCard({ businessName, result }: { businessName: string; result: ReadinessScoreResult }) {
  const tone = scoreTone(result.score);

  return (
    <div className="space-y-6">
      <section aria-labelledby="readiness-score-title" className="relative overflow-hidden rounded-2xl bg-brand-soft">
        <div className="grid items-center gap-8 px-6 py-8 sm:px-10 md:grid-cols-[auto_minmax(0,1fr)_auto]">
          <ScoreRing score={result.score} size={164} className="mx-auto md:mx-0" />
          <div className="text-center md:text-left">
            <p className="text-sm font-semibold text-muted-foreground">{businessName}의 마케팅 준비 점수</p>
            <h2 id="readiness-score-title" className="mt-1 text-2xl font-extrabold tracking-[-0.04em] sm:text-[1.75rem]">{tone.label}</h2>
            <p className="mt-3 max-w-md text-[15px] leading-7 text-muted-foreground">
              {result.nextTodo
                ? `가장 먼저 해볼 일은 ${result.nextTodo.todo}이에요. 여기부터 하면 점수가 가장 빨리 올라요.`
                : "핵심 항목이 모두 채워졌어요. 이제 캘린더의 계획대로 콘텐츠를 만들어보세요."}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 md:justify-start">
              {result.nextTodo ? <Button asChild><Link href={result.nextTodo.href}>{result.nextTodo.cta} <ArrowRight aria-hidden="true" /></Link></Button> : null}
              <Button asChild variant={result.nextTodo ? "outline" : "default"}><Link href="/calendar">마케팅 캘린더 보기</Link></Button>
            </div>
          </div>
          <Mascot pose={result.score >= 80 ? "thumbsUp" : "point"} size={170} className="hidden w-[150px] md:block lg:w-[170px]" />
        </div>
      </section>

      <section aria-labelledby="readiness-breakdown-title">
        <h2 id="readiness-breakdown-title" className="text-lg font-bold tracking-[-0.02em]">점수는 이렇게 계산했어요</h2>
        <p className="mt-1 text-[15px] text-muted-foreground">저장된 사업 정보와 연결 상태, 최근 30일 제작 기록을 기준으로 해요.</p>
        <ul className="mt-5 divide-y divide-border border-y border-border">
          {result.rows.map((row) => (
            <li key={row.key} className="grid items-center gap-x-6 gap-y-2 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]">
              <div className="flex min-w-0 items-start gap-3">
                <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${row.ready ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
                  {row.ready ? <Check className="size-3.5" strokeWidth={3} aria-label="준비됨" /> : <CircleAlert className="size-3.5" strokeWidth={3} aria-label="보완 필요" />}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{row.label}</p>
                  <p className="truncate text-sm text-muted-foreground">{row.detail}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Progress value={(row.points / row.max) * 100} className="h-1.5" aria-label={`${row.label} ${row.max}점 중 ${row.points}점`} />
                <span className="tabular w-12 shrink-0 text-right text-sm font-bold">{row.points}<span className="font-medium text-muted-foreground">/{row.max}</span></span>
              </div>
              <div className="md:text-right">
                {row.ready ? null : <Link href={row.href} className="text-sm font-semibold text-primary hover:underline">{row.cta} →</Link>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
