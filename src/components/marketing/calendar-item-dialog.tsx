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
  instagram_reels: "Instagram 릴스",
  youtube_shorts: "YouTube 쇼츠",
};
const STATUS_LABEL: Record<CalendarItemStatus, string> = {
  PLANNED: "계획",
  GENERATED: "제작 완료",
  PUBLISHED: "게시 완료",
  SKIPPED: "건너뜀",
};

function platformTone(platform: CalendarPlatform) {
  if (platform === "blog") return "border-blue-200 bg-blue-50 text-blue-800";
  if (platform === "instagram_reels") return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800";
  return "border-red-200 bg-red-50 text-red-800";
}

function statusTone(status: CalendarItemStatus) {
  if (status === "PUBLISHED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "GENERATED") return "border-violet-200 bg-violet-50 text-violet-800";
  if (status === "SKIPPED") return "border-slate-200 bg-slate-100 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function disabledReason(item: CalendarItem, isToday: boolean): string | null {
  if (item.status !== "PLANNED") return "이 항목은 이미 처리되었습니다.";
  if (!isToday) return "예정일이 오늘인 콘텐츠만 바로 생성할 수 있습니다.";
  if (item.platform === "instagram_reels") return "Instagram 릴스 생성 연결은 준비 중입니다.";
  if (item.platform === "youtube_shorts" && AUTOMATION_AVAILABILITY.shorts !== "AVAILABLE") {
    return "YouTube Shorts 자동화는 Coming Soon입니다.";
  }
  return null;
}

export function CalendarItemDialog({
  item,
  isToday,
  variant = "compact",
}: {
  item: CalendarItem;
  isToday: boolean;
  variant?: "compact" | "card";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const reason = disabledReason(item, isToday);

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
        toast.success("오늘의 콘텐츠를 생성하고 캘린더에 연결했습니다.");
        setOpen(false);
        router.refresh();
      } catch {
        const message = "콘텐츠를 생성하지 못했습니다. 잠시 후 다시 시도해주세요.";
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) { setOpen(nextOpen); if (!nextOpen) setError(""); } }}>
      <DialogTrigger asChild>
        {variant === "compact" ? (
          <button type="button" className={`block w-full rounded-md border px-2 py-1.5 text-left text-[11px] leading-4 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${platformTone(item.platform)}`}>
            <span className="block truncate font-semibold">{item.topic}</span>
            <span className="block truncate opacity-75">{PLATFORM_LABEL[item.platform]} · {STATUS_LABEL[item.status]}</span>
          </button>
        ) : (
          <button type="button" className="block w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={platformTone(item.platform)}>{PLATFORM_LABEL[item.platform]}</Badge>
              <Badge variant="outline" className={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Badge>
              <span className="text-xs text-slate-500">{item.content_type}</span>
            </span>
            <span className="mt-3 block text-sm font-semibold text-slate-950">{item.topic}</span>
            <span className="mt-1.5 line-clamp-2 block text-xs leading-5 text-slate-600">{item.summary}</span>
          </button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <Badge variant="outline" className={platformTone(item.platform)}>{PLATFORM_LABEL[item.platform]}</Badge>
            <Badge variant="outline" className={statusTone(item.status)}>{STATUS_LABEL[item.status]}</Badge>
          </div>
          <DialogTitle className="pt-1 text-xl leading-7">{item.topic}</DialogTitle>
          <DialogDescription>{item.planned_date} · {item.content_type}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">콘텐츠 개요</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">{item.summary}</p>
          </section>
          <dl className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <div><dt className="text-xs font-medium text-slate-500">마케팅 목표</dt><dd className="mt-1.5 text-sm leading-6 text-slate-900">{item.goal}</dd></div>
            <div><dt className="text-xs font-medium text-slate-500">CTA</dt><dd className="mt-1.5 text-sm leading-6 text-slate-900">{item.cta}</dd></div>
          </dl>
          {reason && item.status === "PLANNED" ? (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800"><CalendarClock className="mt-0.5 size-4 shrink-0" />{reason}</p>
          ) : null}
          {item.status === "GENERATED" ? (
            <p className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-800"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />생성 결과가 콘텐츠 기록에 저장되고 자동화와 연결되었습니다.</p>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline" disabled={isPending}>닫기</Button></DialogClose>
          {item.status === "GENERATED" && item.automation_id ? (
            <Button asChild variant="outline"><Link href={`/automations/${item.automation_id}`}><WandSparkles /> 생성 결과 보기</Link></Button>
          ) : null}
          {item.status === "PLANNED" ? (
            <Button type="button" onClick={handleGenerate} disabled={Boolean(reason) || isPending} className="bg-blue-600 text-white hover:bg-blue-700">
              {isPending ? <Loader2 className="animate-spin" /> : <Play />}
              {isPending ? "콘텐츠 생성 중..." : "오늘 콘텐츠 생성"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
