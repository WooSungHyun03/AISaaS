"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { advanceAutomationRun, triggerRunNow } from "@/app/(app)/automations/actions";

export function RunNowButton({ automationId, hasInFlightRun = false, progress = null }: { automationId: string; hasInFlightRun?: boolean; progress?: string | null }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Long content (a blog post is planned, written section by section and checked) is made in short background
  // steps. While one is in flight, nudge it forward every few seconds; the cron tick does the same when nobody
  // has the page open.
  const stepping = useRef(false);
  useEffect(() => {
    if (!hasInFlightRun) return;
    const step = async () => {
      if (stepping.current) return;
      stepping.current = true;
      try {
        const result = await advanceAutomationRun(automationId);
        if (result.error) toast.error(result.error);
        else if (result.pending === false) toast.success("콘텐츠를 만들었어요. 아래에서 결과를 확인하세요.");
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

  const handleClick = () => {
    startTransition(async () => {
      try {
        const result = await triggerRunNow(automationId);
        if (result.error) toast.error(result.error);
        else if (result.pending) toast.success("만들기를 시작했어요. 몇 분 안에 완성돼요.");
        else toast.success("콘텐츠를 만들었어요. 아래에서 결과를 확인하세요.");
      } catch {
        toast.error("만들기 상태를 확인하지 못했어요. 잠시 후 다시 시도해주세요.");
      } finally {
        router.refresh();
      }
    });
  };

  const busy = isPending || hasInFlightRun;
  return (
    <Button variant="spark" onClick={handleClick} disabled={busy}>
      {busy ? (progress ? `${progress}…` : "만드는 중…") : "지금 만들기"}
    </Button>
  );
}
