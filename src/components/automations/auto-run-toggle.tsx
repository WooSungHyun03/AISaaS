"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { activateAutomation, pauseAutomation } from "@/app/(app)/automations/actions";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { AutomationStatus } from "@/types/domain";

const format = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * "정해진 때마다 자동으로 만들기": the on/off switch of a schedule. A schedule that is only saved (DRAFT) or was parked
 * after repeated failures (ERROR) makes nothing, and this says so next to the schedule instead of letting it look active.
 */
export function AutoRunToggle({ automationId, status, nextRunAt, disabled }: { automationId: string; status: AutomationStatus; nextRunAt: string | null; disabled?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<AutomationStatus | null>(null);
  const shown = optimistic ?? status;
  const on = shown === "ACTIVE";

  function change(next: boolean) {
    setOptimistic(next ? "ACTIVE" : "PAUSED");
    startTransition(async () => {
      try {
        const result = next ? await activateAutomation(automationId) : await pauseAutomation(automationId);
        if (result.error) {
          setOptimistic(null);
          toast.error(result.error);
          return;
        }
        toast.success(next ? "정해진 때마다 자동으로 만들도록 켰어요." : "자동 만들기를 껐어요.");
        router.refresh();
      } catch {
        setOptimistic(null);
        toast.error("상태를 바꾸지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <Switch checked={on} onCheckedChange={change} disabled={disabled || isPending} aria-label="정해진 때마다 자동으로 만들기" />
        자동으로 만들기 {on ? "켜짐" : "꺼짐"}
      </label>
      {on && nextRunAt ? <Badge variant="brand">다음 제작 {format(nextRunAt)}</Badge> : null}
      {shown === "ERROR" ? <Badge variant="destructive">여러 번 실패해서 멈췄어요 · 켜면 다시 시작해요</Badge> : null}
      {shown === "DRAFT" ? <span className="text-[13px] text-muted-foreground">설정만 저장돼 있어요. 켜야 정해진 요일에 만들어요.</span> : null}
    </div>
  );
}
