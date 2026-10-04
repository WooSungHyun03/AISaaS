"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, Loader2, Play, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { triggerCalendarItemNow } from "@/app/(app)/calendar/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CalendarItem, CalendarItemStatus, CalendarPlatform } from "@/types/domain";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";

const PLATFORM_LABEL: Record<CalendarPlatform, string> = {
  blog: "블로그",
  instagram_reels: "인스타 릴스",
  youtube_shorts: "유튜브 쇼츠",
};
const STATUS_LABEL: Record<CalendarItemStatus, string> = {
  PLANNED: "계획",
  GENERATED: "제작 완료",
  PUBLISHED: "게시 완료",
  SKIPPED: "건너뜀",
};

function platformTone(platform: CalendarPlatform) {
  if (platform === "blog") return "border-transparent bg-brand-soft text-primary";
  if (platform === "instagram_reels") return "border-transparent bg-warning-soft text-warning";
  return "border-transparent bg-destructive/10 text-destructive";
}

function statusTone(status: CalendarItemStatus) {
  if (status === "PUBLISHED" || status === "GENERATED") return "border-transparent bg-success-soft text-success";
  if (status === "SKIPPED") return "border-transparent bg-muted text-muted-foreground";
  return "border-border bg-card text-muted-foreground";
}

function disabledReason(item: CalendarItem): string | null {
  if (item.status !== "PLANNED") return "이미 처리된 항목이에요.";
  if (item.platform === "instagram_reels") return "인스타 릴스 제작은 준비 중이에요.";
  if (item.platform === "youtube_shorts" && AUTOMATION_AVAILABILITY.shorts !== "AVAILABLE") {
    return "유튜브 쇼츠 제작은 준비 중이에요.";
  }
  return null;
}

export function CalendarItemDialog({
  item,
  variant = "compact",
}: {
  item: CalendarItem;
  variant?: "compact" | "card";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const reason = disabledReason(item);

  function handleGenerate() {
    setError("");
    startTransition(async () => {
      try {
        const result = await triggerCalendarItemNow(item.id);
        if (result.error) {
          setError(result.error);
          toast.error(result.error);
          return;
        }
        toast.success(item.platform === "youtube_shorts" ? "숏폼 영상을 만들고 캘린더에 연결했어요. 숏폼 스튜디오에서 확인하세요." : "콘텐츠를 만들고 캘린더에 연결했어요.");
        setOpen(false);
        router.refresh();
      } catch {
        const message = "콘텐츠를 만들지 못했어요. 잠시 후 다시 시도해주세요.";
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) { setOpen(nextOpen); if (!nextOpen) setError(""); } }}>
      <DialogTrigger asChild>
        {variant === "compact" ? (
          <button type="button" className={`block w-full cursor-pointer rounded-md border px-2 py-1.5 text-left text-xs leading-4 transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring ${platformTone(item.platform)}`}>
            <span className="block truncate font-bold">{item.topic}</span>
            <span className="block truncate opacity-80">{PLATFORM_LABEL[item.platform]} · {STATUS_LABEL[item.status]}</span>
          </button>
        ) : (
          <button type="button" className="block w-full cursor-pointer rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-brand-soft/40 focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={platformTone(item.platform)}>{PLATFORM_LABEL[item.platform]}</Badge>
              <Badge variant="outline" className={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Badge>
            </span>
            <span className="mt-3 block font-bold leading-6">{item.topic}</span>
            <span className="mt-1.5 line-clamp-2 block text-sm leading-6 text-muted-foreground">{item.summary}</span>
          </button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <Badge variant="outline" className={platformTone(item.platform)}>{PLATFORM_LABEL[item.platform]}</Badge>
            <Badge variant="outline" className={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Badge>
          </div>
          <DialogTitle className="pt-1 text-xl font-extrabold leading-8 tracking-[-0.03em]">{item.topic}</DialogTitle>
          <DialogDescription>{item.planned_date.replaceAll("-", ".")} · {item.content_type}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <section>
            <h3 className="text-sm font-bold">콘텐츠 개요</h3>
            <p className="mt-2 text-[15px] leading-7 text-muted-foreground">{item.summary}</p>
          </section>
          <dl className="grid gap-4 rounded-xl bg-muted p-4 sm:grid-cols-2">
            <div><dt className="text-[13px] font-semibold text-muted-foreground">마케팅 목표</dt><dd className="mt-1 text-[15px] leading-7">{item.goal}</dd></div>
            <div><dt className="text-[13px] font-semibold text-muted-foreground">행동 유도 문구 (CTA)</dt><dd className="mt-1 text-[15px] leading-7">{item.cta}</dd></div>
          </dl>
          {reason && item.status === "PLANNED" ? (
            <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm leading-6 text-warning"><CalendarClock className="mt-1 size-4 shrink-0" aria-hidden="true" />{reason}</p>
          ) : null}
          {item.status === "GENERATED" ? (
            <p className="flex items-start gap-2 rounded-lg bg-success-soft p-3 text-sm leading-6 text-success"><CheckCircle2 className="mt-1 size-4 shrink-0" aria-hidden="true" />만든 결과가 제작 기록에 저장돼 있어요.</p>
          ) : null}
          {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline" disabled={isPending}>닫기</Button></DialogClose>
          {item.status === "GENERATED" && item.automation_id ? (
            <Button asChild variant="outline"><Link href={`/automations/${item.automation_id}`}><WandSparkles aria-hidden="true" /> 만든 결과 보기</Link></Button>
          ) : null}
          {item.status === "PLANNED" ? (
            <Button type="button" onClick={handleGenerate} disabled={Boolean(reason) || isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
              {isPending ? "콘텐츠를 만드는 중…" : "이 콘텐츠 만들기"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
