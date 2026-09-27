"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { activateAutomation, deleteAutomation, pauseAutomation } from "@/app/(app)/automations/actions";
import type { AutomationStatus } from "@/types/domain";

export function AutomationStatusActions({ automationId, status, primary = false, hasInFlightRun = false }: { automationId: string; status: AutomationStatus; primary?: boolean; hasInFlightRun?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleStatusChange() {
    startTransition(async () => {
      try {
        if (status === "ACTIVE") {
          const result = await pauseAutomation(automationId);
          if (result.error) { toast.error(result.error); return; }
          toast.success("자동화를 일시정지했습니다.");
        } else {
          const result = await activateAutomation(automationId);
          if (result.error) { toast.error(result.error); return; }
          toast.success("자동화가 활성화되었습니다.");
        }
        router.refresh();
      } catch {
        toast.error("자동화 상태를 변경하지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
    });
  }

  async function handleDelete() {
    let errorShown = false;
    try {
      const result = await deleteAutomation(automationId);
      if (result.error) {
        toast.error(result.error);
        errorShown = true;
        throw new Error(result.error);
      }
      toast.success("자동화를 삭제했습니다.");
      router.replace("/automations");
    } catch (error) {
      if (!errorShown) toast.error("자동화를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.");
      throw error;
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant={status === "ACTIVE" ? "outline" : primary ? "default" : "outline"} onClick={handleStatusChange} disabled={isPending}>
        {isPending ? "변경 중..." : status === "ACTIVE" ? "일시정지" : status === "PAUSED" ? "재개" : "활성화"}
      </Button>
      <ConfirmationDialog
        trigger={<Button type="button" variant="ghost" className="text-destructive hover:text-destructive">삭제</Button>}
        title="자동화를 삭제할까요?"
        description="자동화 설정과 실행 기록이 삭제됩니다. 이 작업은 되돌릴 수 없습니다."
        confirmLabel="자동화 삭제"
        pendingLabel="삭제 중..."
        destructive
        disabled={hasInFlightRun || isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
