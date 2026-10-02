"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { triggerRunNow } from "@/app/(app)/automations/actions";

export function RunNowButton({ automationId, hasInFlightRun = false }: { automationId: string; hasInFlightRun?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!hasInFlightRun) return;
    const timer = window.setInterval(() => router.refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [hasInFlightRun, router]);

  const handleClick = () => {
    startTransition(async () => {
      try {
        const result = await triggerRunNow(automationId);
        if (result.error) toast.error(result.error);
        else toast.success("콘텐츠를 만들었어요. 아래에서 결과를 확인하세요.");
      } catch {
        toast.error("만들기 상태를 확인하지 못했어요. 잠시 후 다시 시도해주세요.");
      } finally {
        router.refresh();
      }
    });
  };

  return (
    <Button variant="spark" onClick={handleClick} disabled={isPending || hasInFlightRun}>
      {isPending || hasInFlightRun ? "만드는 중…" : "지금 만들기"}
    </Button>
  );
}
