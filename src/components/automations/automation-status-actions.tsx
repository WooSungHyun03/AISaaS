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
          toast.success("자동 만들기를 껐어요.");
        } else {
          const result = await activateAutomation(automationId);
          if (result.error) { toast.error(result.error); return; }
          toast.success("자동 만들기를 켰어요.");
        }
        router.refresh();
      } catch {
        toast.error("상태를 바꾸지 못했어요. 잠시 후 다시 시도해주세요.");
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
      toast.success("만들기 설정을 삭제했어요.");
      router.replace("/automations");
    } catch (error) {
      if (!errorShown) toast.error("삭제하지 못했어요. 잠시 후 다시 시도해주세요.");
      throw error;
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant={status === "ACTIVE" ? "outline" : primary ? "default" : "outline"} onClick={handleStatusChange} disabled={isPending}>
        {isPending ? "바꾸는 중…" : status === "ACTIVE" ? "끄기" : "켜기"}
      </Button>
      <ConfirmationDialog
        trigger={<Button type="button" variant="ghost" className="text-destructive hover:text-destructive">삭제</Button>}
        title="이 설정을 삭제할까요?"
        description="설정과 제작 기록이 함께 삭제돼요. 되돌릴 수 없어요."
        confirmLabel="삭제하기"
        pendingLabel="삭제하는 중…"
        destructive
        disabled={hasInFlightRun || isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}
