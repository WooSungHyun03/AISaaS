"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, CircleAlert, CircleCheck, Film, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { advanceShortsJob, createShortsAutomation, generateShortsPreview, saveShortsSchedule } from "@/app/(app)/shorts/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { ScheduleFields, ScheduleHiddenInputs, scheduleToValue } from "@/components/automations/schedule-fields";
import { cn } from "@/lib/utils";
import type { AutomationSchedule } from "@/types/automation";

interface Preview {
  runId: string;
  createdAt: string;
  videoUrl: string;
  hook: string | null;
  topic: string | null;
  caption: string | null;
  script: string | null;
  scenes: Array<{ text: string; durationSec: number }>;
  format: "ad" | "character" | "promo" | null;
  durationSec: number | null;
  voiceFallback: boolean;
  /** The quality check. There is no "approved" state: the owner makes the final call. */
  qa: { status: "REJECTED" | "NEEDS_HUMAN_CHECK"; summary: string | null; aiChecked: boolean; findings: Array<{ severity: "reject" | "warn"; message: string }>; notes: string[] } | null;
  /** A placeholder from a test generator, not a real video. */
  sample: boolean;
}

/** Where an in-flight video is: the stage of the background job and which attempt (a rejected video is made once more). */
export interface ShortsJobInfo {
  stage: "SUBMIT" | "WAIT" | "CHECK" | "VOICE" | "FINISH";
  attempt: number;
  needsVoice: boolean;
}

const JOB_STEPS = [
  { key: "plan", label: "기획·준비", stages: [] as string[] },
  { key: "generate", label: "영상 만들기", stages: ["SUBMIT", "WAIT"] },
  { key: "check", label: "품질 점검", stages: ["CHECK"] },
  { key: "voice", label: "한국어 음성", stages: ["VOICE"] },
  { key: "finish", label: "마무리", stages: ["FINISH"] },
];

function JobSteps({ job }: { job: ShortsJobInfo | null }) {
  const currentIndex = job ? Math.max(1, JOB_STEPS.findIndex((step) => step.stages.includes(job.stage))) : 0;
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <ol className="flex flex-wrap gap-2" aria-label="영상 만들기 진행 단계">
        {JOB_STEPS.filter((step) => step.key !== "voice" || job?.needsVoice || job?.stage === "VOICE").map((step) => {
          const index = JOB_STEPS.indexOf(step);
          const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
          return (
            <li key={step.key} aria-current={state === "current" ? "step" : undefined} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold", state === "done" && "border-success/30 bg-success-soft text-success", state === "current" && "border-primary bg-brand-soft text-primary", state === "todo" && "text-muted-foreground")}>
              {state === "done" ? <Check className="size-3.5" aria-hidden="true" /> : state === "current" ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
              {step.label}
            </li>
          );
        })}
      </ol>
      {job && job.attempt > 1 ? <p className="text-xs leading-5 text-muted-foreground">처음 만든 영상이 기준에 맞지 않아 한 번 더 만들고 있어요. (두 번째이자 마지막 시도예요)</p> : null}
    </div>
  );
}

export function ShortsCreateButton({ businessId }: { businessId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return <Button variant="spark" disabled={pending} onClick={() => startTransition(async () => {
    const result = await createShortsAutomation(businessId);
    if (result.error) toast.error(result.error);
    else {
      toast.success("숏폼 만들기 설정을 준비했어요.");
      router.refresh();
    }
  })}>{pending ? "준비 중…" : "숏폼 만들기 시작"}</Button>;
}

export function ShortsStudio({
  automationId,
  automationStatus,
  schedule,
  latestPreview,
  hasInFlightRun,
  progress,
  job,
  nextRunAt,
  referencesSlot,
  publishingSlot,
  hasImages,
}: {
  automationId: string;
  automationStatus: string;
  schedule: AutomationSchedule;
  latestPreview: Preview | null;
  hasInFlightRun: boolean;
  /** Short status of a video that is being made in the background, if any. */
  progress: string | null;
  job: ShortsJobInfo | null;
  nextRunAt: string | null;
  /** The materials card (photos, clips, audio, logo, length, voice); rendered between the preview and the schedule. */
  referencesSlot?: ReactNode;
  /** Title, description, keywords and hashtags for the latest video (editable; what gets posted). */
  publishingSlot?: ReactNode;
  /** Without a photo or a clip there is nothing to build a video from yet. */
  hasImages: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyAction, setBusyAction] = useState<"generate" | "schedule" | null>(null);
  const [scheduleValue, setScheduleValue] = useState(() => scheduleToValue(schedule, { timeOfDay: "18:00" }));
  const busy = pending || hasInFlightRun;

  // While a video is being made in the background, nudge it forward every few seconds (the cron tick
  // does the same when nobody has the page open) and show what changed.
  const stepping = useRef(false);
  useEffect(() => {
    if (!hasInFlightRun) return;
    const step = async () => {
      if (stepping.current) return;
      stepping.current = true;
      try {
        const result = await advanceShortsJob(automationId);
        if (result.error) toast.error(result.error);
        else if (result.pending === false) toast.success("영상이 완성됐어요.");
      } catch {
        // The next tick retries.
      } finally {
        stepping.current = false;
        router.refresh();
      }
    };
    const timer = window.setInterval(() => void step(), 6_000);
    return () => window.clearInterval(timer);
  }, [hasInFlightRun, automationId, router]);

  const run = (kind: typeof busyAction, task: () => Promise<{ error?: string; pending?: boolean }>, success: string, pendingMessage?: string) => {
    setBusyAction(kind);
    startTransition(async () => {
      try {
        const result = await task();
        if (result.error) toast.error(result.error);
        else toast.success(result.pending && pendingMessage ? pendingMessage : success);
      } catch {
        toast.error("요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.");
      } finally {
        setBusyAction(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-8">
      {hasInFlightRun ? <div className="space-y-3 rounded-2xl border bg-card p-4 sm:p-5">
        <p className="text-sm font-semibold">{progress ?? "영상 만들기가 진행 중이에요"}</p>
        <JobSteps job={job} />
        <p className="text-xs leading-5 text-muted-foreground">광고 영상은 몇 분에서 십여 분 걸릴 수 있어요. 이 화면을 닫아도 계속 만들어지고, 끝나면 이곳에 나타나요.</p>
      </div> : null}
      {automationStatus === "ERROR" ? <FormMessage>최근 실행 오류로 예약이 멈췄어요. 아래 예약 설정을 다시 저장해주세요.</FormMessage> : null}

      <section aria-labelledby="preview-heading" className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
        <div className="overflow-hidden rounded-3xl border bg-neutral-950 shadow-sm">
          {latestPreview?.sample ? (
            <div className="flex aspect-[9/16] min-h-[480px] flex-col items-center justify-center gap-3 px-8 text-center text-white" role="status">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-white/10"><Film className="size-7" aria-hidden="true" /></span>
              <p className="font-bold">테스트용 샘플이에요</p>
              <p className="text-sm leading-6 text-white/65">영상 제작 서비스가 연결되지 않은 환경이라 실제 영상은 만들어지지 않았어요. 대본·장면 구성만 확인할 수 있고, 게시할 수 없어요.</p>
            </div>
          ) : latestPreview ? (
            <video
              key={latestPreview.videoUrl}
              src={latestPreview.videoUrl}
              controls
              preload="metadata"
              playsInline
              className="aspect-[9/16] max-h-[680px] w-full bg-black object-contain"
              aria-label="생성된 숏폼 영상 미리보기"
            >브라우저에서 영상 미리보기를 지원하지 않습니다.</video>
          ) : (
            <div className="flex aspect-[9/16] min-h-[480px] flex-col items-center justify-center gap-4 px-8 text-center text-white">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-white/10"><Film className="size-7" aria-hidden="true" /></span>
              <div><p className="font-bold">아직 미리보기가 없어요</p><p className="mt-1 text-sm leading-6 text-white/65">AI가 광고 기획을 하고 20~30초 세로 영상을 한 번에 만들어요.</p></div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 id="preview-heading" className="text-xl font-extrabold tracking-[-0.03em]">영상 만들기와 미리보기</h2><p className="mt-1 text-sm text-muted-foreground">{hasImages ? "게시 전에 영상과 문구를 직접 확인할 수 있어요." : "먼저 아래에서 상품·매장 사진을 추가해주세요. 사진을 올리면 AI가 그 모습을 살려 광고 영상으로 만들어요."}</p></div>
              <Button variant="spark" disabled={busy || !hasImages} onClick={() => run("generate", () => generateShortsPreview(automationId), "새 미리보기를 만들었어요.", "영상 만들기를 시작했어요. 완성되면 여기에 나타나요.")}>
                {busy && (busyAction === "generate" || hasInFlightRun) ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Film aria-hidden="true" />}
                {busy && (busyAction === "generate" || hasInFlightRun) ? "만드는 중…" : latestPreview ? "새 영상 만들기" : "영상 만들기"}
              </Button>
            </div>
          </div>

          {latestPreview ? <div className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="brand">{latestPreview.sample ? "테스트 샘플(AI 대본)" : latestPreview.format === "ad" ? "AI 광고 영상" : "AI 생성 영상"}{latestPreview.durationSec ? ` · ${latestPreview.durationSec}초` : ""}</Badge>
              {latestPreview.voiceFallback ? <Badge variant="secondary">한국어 음성을 따로 입혔어요</Badge> : null}
            </div>
            <div><p className="text-xs font-semibold text-muted-foreground">후킹 문구</p><p className="mt-1 text-lg font-bold leading-7">{latestPreview.hook ?? "제목 없음"}</p>{latestPreview.topic ? <p className="mt-1 text-sm text-muted-foreground">주제 · {latestPreview.topic}</p> : null}</div>
            {latestPreview.qa ? <section aria-label="품질 점검 결과" className="space-y-2 rounded-xl bg-muted px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-bold">{latestPreview.qa.findings.some((finding) => finding.severity === "warn") || latestPreview.qa.notes.length > 0 ? <CircleAlert className="size-4 text-warning" aria-hidden="true" /> : <CircleCheck className="size-4 text-success" aria-hidden="true" />}직접 한 번 확인해 주세요</p>
              <p className="text-xs leading-5 text-muted-foreground">AI가 화면과 소리를 자동으로 점검했지만 승인은 사람이 해요. 상품 모양, 라벨 글자, 가격·전화번호가 사실과 같은지 보고 게시해 주세요.{latestPreview.qa.aiChecked ? "" : " (이번에는 AI 화면 점검을 하지 못했어요.)"}</p>
              {latestPreview.qa.summary ? <p className="text-sm leading-6">{latestPreview.qa.summary}</p> : null}
              {latestPreview.qa.findings.filter((finding) => finding.severity === "warn").length + latestPreview.qa.notes.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-sm leading-6">{[...latestPreview.qa.findings.filter((finding) => finding.severity === "warn").map((finding) => finding.message), ...latestPreview.qa.notes].map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul> : null}
            </section> : null}
            {latestPreview.caption && !publishingSlot ? <div><p className="text-xs font-semibold text-muted-foreground">게시 문구</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{latestPreview.caption}</p></div> : null}
            {latestPreview.scenes.length ? <details className="group"><summary className="cursor-pointer text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">장면 구성 {latestPreview.scenes.length}개 보기</summary><ol className="mt-3 space-y-2">{latestPreview.scenes.map((scene, index) => <li key={`${index}-${scene.text}`} className="flex gap-3 rounded-xl bg-muted px-3 py-2 text-sm"><span className="font-bold text-primary">{index + 1}</span><span className="flex-1">{scene.text}</span><span className="text-muted-foreground">{scene.durationSec}초</span></li>)}</ol></details> : null}
          </div> : null}

          {latestPreview && !latestPreview.sample ? <p><a href={latestPreview.videoUrl} download target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary underline underline-offset-2">영상 파일 다운로드</a></p> : null}

          {publishingSlot}

          <div className="rounded-2xl border bg-card p-5 sm:p-6">
            <h3 className="font-bold">내 채널에 올리기</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">영상 파일을 내려받고 위 게시 문구(제목·설명·태그)를 복사해서 YouTube Shorts나 인스타그램 릴스 등에 직접 올려주세요. 계정 연결이나 자동 게시는 하지 않아요.</p>
          </div>
        </div>
      </section>

      {referencesSlot}

      <section aria-labelledby="schedule-heading" className="rounded-2xl border bg-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary"><CalendarClock className="size-5" aria-hidden="true" /></span><div><h2 id="schedule-heading" className="text-lg font-extrabold tracking-[-0.03em]">예약 만들기</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">저장하면 예약 시각마다 새 영상을 만들어 둬요. 자동으로 게시하지는 않으니, 만든 영상을 확인한 뒤 내려받아 직접 올려주세요.</p></div></div>{nextRunAt && automationStatus === "ACTIVE" ? <Badge variant="brand">다음 만들기 {new Date(nextRunAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</Badge> : <Badge variant="secondary">예약 꺼짐</Badge>}</div>
        <form className="mt-6 space-y-5" action={(formData) => run("schedule", () => saveShortsSchedule(automationId, formData), "예약 설정을 저장하고 켰어요.")}>
          <ScheduleFields idPrefix="shorts" label="예약" value={scheduleValue} onChange={setScheduleValue} disabled={busy} />
          <ScheduleHiddenInputs value={scheduleValue} />
          <div className="flex flex-wrap items-center gap-3"><Button type="submit" variant="outline" disabled={busy || !hasImages}>{busyAction === "schedule" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check aria-hidden="true" />}{busyAction === "schedule" ? "저장 중…" : "예약 저장하고 켜기"}</Button></div>
        </form>
      </section>
    </div>
  );
}

