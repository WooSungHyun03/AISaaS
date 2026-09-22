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
        else toast.success("자동화가 실행되었습니다. 아래에서 생성 결과를 확인하세요.");
      } catch {
        toast.error("실행 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.");
      } finally {
        router.refresh();
      }
    });
  };

  return (
    <Button onClick={handleClick} disabled={isPending || hasInFlightRun}>
      {isPending || hasInFlightRun ? "실행 중..." : "Run Now"}
    </Button>
  );
}
