"use client";

import { Button } from "@/components/ui/button";
import { activateAutomation, deleteAutomation, pauseAutomation } from "@/app/(app)/automations/actions";
import type { AutomationStatus } from "@/types/domain";

export function AutomationStatusActions({ automationId, status }: { automationId: string; status: AutomationStatus }) {
  return (
    <div className="flex gap-2">
      {status === "ACTIVE" ? (
        <form action={pauseAutomation.bind(null, automationId)}>
          <Button type="submit" variant="outline">
            일시정지
          </Button>
        </form>
      ) : (
        <form action={activateAutomation.bind(null, automationId)}>
          <Button type="submit" variant="outline">
            활성화
          </Button>
        </form>
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
