"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { triggerRunNow } from "@/app/(app)/automations/actions";

export function RunNowButton({ automationId }: { automationId: string }) {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const result = await triggerRunNow(automationId);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("자동화가 실행되었습니다.");
      }
    });
  };

  return (
    <Button onClick={handleClick} disabled={isPending}>
      {isPending ? "실행 중..." : "Run Now"}
    </Button>
  );
}
