"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { removeChannel } from "@/app/(app)/diagnosis/actions";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

/** "채널 삭제" — 잘못 등록한 채널을 지우면 매일 수집과 성장 리포트에서도 빠진다. */
export function RemoveChannelButton({ channelId, channelLabel }: { channelId: string; channelLabel: string }) {
  return (
    <ConfirmationDialog
      trigger={
        <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" aria-label={`${channelLabel} 채널 삭제`}>
          <Trash2 aria-hidden="true" />
          삭제
        </Button>
      }
      title="이 채널을 삭제할까요?"
      description="진단 결과와 지금까지 모은 성장 기록도 함께 삭제되고, 매일 수집에서도 빠져요. 삭제하면 되돌릴 수 없어요."
      confirmLabel="채널 삭제"
      pendingLabel="삭제하는 중…"
      destructive
      onConfirm={async () => {
        const result = await removeChannel(channelId);
        if (result.error) {
          toast.error(result.error);
          throw new Error(result.error);
        }
        toast.success("채널을 삭제했어요.");
      }}
    />
  );
}
