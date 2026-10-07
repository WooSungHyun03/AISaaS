"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, ExternalLink, Film, LoaderCircle, Play, Send } from "lucide-react";
import { toast } from "sonner";
import { createShortsAutomation, generateShortsPreview, publishShortsNow, saveShortsSchedule } from "@/app/(app)/shorts/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { ScheduleFields, ScheduleHiddenInputs, scheduleToValue } from "@/components/automations/schedule-fields";
import { cn } from "@/lib/utils";
import type { AutomationSchedule, ShortsPublishPlatform } from "@/types/automation";

const PLATFORM = {
  instagram: { label: "Instagram Reels", icon: Film },
  youtube: { label: "YouTube Shorts", icon: Play },
} as const;

interface Preview {
  runId: string;
  createdAt: string;
  videoUrl: string;
  hook: string | null;
  topic: string | null;
  caption: string | null;
  script: string | null;
  scenes: Array<{ text: string; durationSec: number }>;
}

interface Publication {
  runId: string;
  createdAt: string;
  platform: ShortsPublishPlatform;
  externalId: string | null;
  externalUrl: string | null;
  privacy: "private" | null;
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
  configuredPlatforms,
  connections,
  latestPreview,
  publications,
  hasInFlightRun,
  nextRunAt,
}: {
  automationId: string;
  automationStatus: string;
  schedule: AutomationSchedule;
  configuredPlatforms: ShortsPublishPlatform[];
  connections: Record<ShortsPublishPlatform, string | null>;
  latestPreview: Preview | null;
  publications: Publication[];
  hasInFlightRun: boolean;
  nextRunAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyAction, setBusyAction] = useState<"generate" | "publish" | "schedule" | null>(null);
  const [scheduleValue, setScheduleValue] = useState(() => scheduleToValue(schedule, { timeOfDay: "18:00" }));
  const [platforms, setPlatforms] = useState<ShortsPublishPlatform[]>(() =>
    configuredPlatforms.filter((platform) => connections[platform] === "CONNECTED"),
  );
  const busy = pending || hasInFlightRun;

  useEffect(() => {
    if (!hasInFlightRun) return;
    const timer = window.setInterval(() => router.refresh(), 8_000);
    return () => window.clearInterval(timer);
  }, [hasInFlightRun, router]);

  const togglePlatform = (platform: ShortsPublishPlatform) => {
    setPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  };

  const run = (kind: typeof busyAction, task: () => Promise<{ error?: string }>, success: string) => {
    setBusyAction(kind);
    startTransition(async () => {
      try {
        const result = await task();
        if (result.error) toast.error(result.error);
        else toast.success(success);
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
      {hasInFlightRun ? <FormMessage variant="info">영상 생성 또는 게시가 진행 중이에요. 완료될 때까지 중복 실행을 막고 자동으로 상태를 확인합니다.</FormMessage> : null}
      {automationStatus === "ERROR" ? <FormMessage>최근 실행 오류로 예약이 멈췄어요. 연결을 확인한 뒤 아래 예약 설정을 다시 저장해주세요.</FormMessage> : null}

      <section aria-labelledby="preview-heading" className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
        <div className="overflow-hidden rounded-3xl border bg-neutral-950 shadow-sm">
          {latestPreview ? (
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
              <div><p className="font-bold">아직 미리보기가 없어요</p><p className="mt-1 text-sm leading-6 text-white/65">AI가 대본과 장면을 만들고 세로 영상을 렌더링해요.</p></div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 id="preview-heading" className="text-xl font-extrabold tracking-[-0.03em]">영상 만들기와 미리보기</h2><p className="mt-1 text-sm text-muted-foreground">게시 전에 영상과 문구를 직접 확인할 수 있어요.</p></div>
              <Button variant="spark" disabled={busy} onClick={() => run("generate", () => generateShortsPreview(automationId), "새 미리보기를 만들었어요.")}>
                {busy && (busyAction === "generate" || hasInFlightRun) ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Film aria-hidden="true" />}
                {busy && (busyAction === "generate" || hasInFlightRun) ? "만드는 중…" : latestPreview ? "새 영상 만들기" : "영상 만들기"}
              </Button>
            </div>
          </div>

          {latestPreview ? <div className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6">
            <div><p className="text-xs font-semibold text-muted-foreground">후킹 문구</p><p className="mt-1 text-lg font-bold leading-7">{latestPreview.hook ?? "제목 없음"}</p>{latestPreview.topic ? <p className="mt-1 text-sm text-muted-foreground">주제 · {latestPreview.topic}</p> : null}</div>
            {latestPreview.caption ? <div><p className="text-xs font-semibold text-muted-foreground">게시 문구</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{latestPreview.caption}</p></div> : null}
            {latestPreview.scenes.length ? <details className="group"><summary className="cursor-pointer text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">장면 구성 {latestPreview.scenes.length}개 보기</summary><ol className="mt-3 space-y-2">{latestPreview.scenes.map((scene, index) => <li key={`${index}-${scene.text}`} className="flex gap-3 rounded-xl bg-muted px-3 py-2 text-sm"><span className="font-bold text-primary">{index + 1}</span><span className="flex-1">{scene.text}</span><span className="text-muted-foreground">{scene.durationSec}초</span></li>)}</ol></details> : null}
          </div> : null}

          <div className="rounded-2xl border bg-card p-5 sm:p-6">
            <h3 className="font-bold">게시할 플랫폼</h3>
            <p className="mt-1 text-sm text-muted-foreground">미리보기를 확인한 뒤 원하는 곳에 바로 게시해요.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(Object.keys(PLATFORM) as ShortsPublishPlatform[]).map((platform) => {
                const item = PLATFORM[platform];
                const Icon = item.icon;
                const connected = connections[platform] === "CONNECTED";
                const checked = platforms.includes(platform);
                return <label key={platform} className={cn("flex items-center gap-3 rounded-xl border p-4", connected ? "cursor-pointer hover:bg-muted/50" : "bg-muted/50 text-muted-foreground")}>
                  <input type="checkbox" checked={checked && connected} disabled={!connected || busy} onChange={() => togglePlatform(platform)} className="size-4 accent-primary" />
                  <Icon className="size-5" aria-hidden="true" /><span className="min-w-0 flex-1 text-sm font-semibold">{item.label}</span>
                  {connected ? <Badge variant="success">연결됨</Badge> : <Link href="/settings" className="text-xs font-semibold text-primary underline underline-offset-2">연결</Link>}
                </label>;
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button disabled={busy || !latestPreview || platforms.length === 0 || platforms.some((platform) => connections[platform] !== "CONNECTED")} onClick={() => latestPreview && run("publish", () => publishShortsNow(automationId, latestPreview.runId, platforms), "선택한 플랫폼에 게시했어요.")}>
                {busyAction === "publish" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send aria-hidden="true" />}{busyAction === "publish" ? "게시 중…" : "지금 게시"}
              </Button>
              <p className="text-xs leading-5 text-muted-foreground">YouTube는 현재 비공개 상태로 업로드됩니다.</p>
            </div>
            <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-xs leading-5 text-muted-foreground">
              TikTok 연동은 공식 API 심사(약 3주, 전용 UI 요건)로 추후 지원 예정입니다.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="schedule-heading" className="rounded-2xl border bg-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-primary"><CalendarClock className="size-5" aria-hidden="true" /></span><div><h2 id="schedule-heading" className="text-lg font-extrabold tracking-[-0.03em]">예약 만들기</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">저장하면 예약 시각마다 새 영상을 만들어요. 위에서 게시할 플랫폼을 골라두면 만든 영상을 그곳에 바로 올리고, 고르지 않으면 영상만 만들어 둬요.</p></div></div>{nextRunAt && automationStatus === "ACTIVE" ? <Badge variant="brand">다음 만들기 {new Date(nextRunAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</Badge> : <Badge variant="secondary">예약 꺼짐</Badge>}</div>
        <form className="mt-6 space-y-5" action={(formData) => run("schedule", () => saveShortsSchedule(automationId, formData), "예약 설정을 저장하고 켰어요.")}>
          <ScheduleFields idPrefix="shorts" label="예약" value={scheduleValue} onChange={setScheduleValue} disabled={busy} />
          <ScheduleHiddenInputs value={scheduleValue} />
          {platforms.map((platform) => <input key={platform} type="hidden" name="platforms" value={platform} />)}
          <div className="flex flex-wrap items-center gap-3"><Button type="submit" variant="outline" disabled={busy}>{busyAction === "schedule" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check aria-hidden="true" />}{busyAction === "schedule" ? "저장 중…" : "예약 저장하고 켜기"}</Button></div>
        </form>
      </section>

      <section aria-labelledby="publish-history-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3"><h2 id="publish-history-heading" className="text-lg font-extrabold tracking-[-0.03em]">최근 게시 결과</h2><Link href="/usage" className="text-sm font-semibold text-primary hover:underline">전체 이용내역</Link></div>
        {publications.length === 0 ? <p className="rounded-2xl bg-muted px-5 py-6 text-sm text-muted-foreground">아직 게시한 기록이 없어요. 영상을 만든 뒤 플랫폼을 선택해 게시해보세요.</p> : <ul className="divide-y overflow-hidden rounded-2xl border bg-card">{publications.map((item) => <li key={`${item.runId}-${item.platform}`} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6"><Badge variant="success">{PLATFORM[item.platform].label}</Badge><span className="min-w-0 flex-1 text-sm text-muted-foreground">{new Date(item.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · ID {item.externalId ?? "확인 중"}{item.privacy === "private" ? " · 비공개" : ""}</span>{item.externalUrl ? <Button asChild size="sm" variant="ghost"><a href={item.externalUrl} target="_blank" rel="noopener noreferrer">열기 <ExternalLink aria-hidden="true" /></a></Button> : null}<Button asChild size="sm" variant="ghost"><Link href={`/automations/${automationId}/runs/${item.runId}`}>기록 보기</Link></Button></li>)}</ul>}
      </section>
    </div>
  );
}

