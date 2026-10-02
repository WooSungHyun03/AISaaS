"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { deleteBusiness } from "@/app/(app)/business/actions";

export function DeleteBusinessButton({ businessId }: { businessId: string }) {
  return (
    <ConfirmationDialog
      trigger={<Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive">삭제</Button>}
      title="이 사업체를 삭제할까요?"
      description="연결된 만들기 설정과 제작 기록도 함께 삭제될 수 있어요. 삭제하면 되돌릴 수 없어요."
      confirmLabel="사업체 삭제"
      pendingLabel="삭제하는 중…"
      destructive
      onConfirm={async () => {
        const result = await deleteBusiness(businessId);
        if (result.error) {
          toast.error(result.error);
          throw new Error(result.error);
        }
        toast.success("사업체를 삭제했어요.");
      }}
    />
  );
}
