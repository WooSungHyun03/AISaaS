"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { activateAutomation, deleteAutomation, pauseAutomation } from "@/app/(app)/automations/actions";
import type { AutomationStatus } from "@/types/domain";

export function AutomationStatusActions({ automationId, status, primary = false }: { automationId: string; status: AutomationStatus; primary?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleActivate() {
    startTransition(async () => {
      try {
        await activateAutomation(automationId);
        toast.success("자동화가 활성화되었습니다.");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "자동화를 활성화하지 못했습니다.");
      }
    });
  }

  return (
    <div className="flex gap-2">
      {status === "ACTIVE" ? (
        <form action={pauseAutomation.bind(null, automationId)}>
          <Button type="submit" variant="outline">
            일시정지
          </Button>
        </form>
      ) : (
        <Button type="button" variant={primary ? "default" : "outline"} onClick={handleActivate} disabled={isPending}>
          {isPending ? "활성화 중..." : "활성화"}
        </Button>
      )}
      <form
        action={deleteAutomation.bind(null, automationId)}
        onSubmit={(event) => {
          if (!confirm("이 자동화를 삭제하시겠습니까?")) {
            event.preventDefault();
          }
        }}
      >
        <Button type="submit" variant="ghost" className="text-destructive hover:text-destructive">
          삭제
        </Button>
      </form>
    </div>
  );
}
