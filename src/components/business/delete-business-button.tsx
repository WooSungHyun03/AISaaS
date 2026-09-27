"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { deleteBusiness } from "@/app/(app)/business/actions";

export function DeleteBusinessButton({ businessId }: { businessId: string }) {
  return (
    <ConfirmationDialog
      trigger={<Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive">삭제</Button>}
      title="사업체를 삭제할까요?"
      description="연결된 자동화와 실행 설정도 함께 삭제될 수 있습니다. 이 작업은 되돌릴 수 없습니다."
      confirmLabel="사업체 삭제"
      pendingLabel="삭제 중..."
      destructive
      onConfirm={async () => {
        const result = await deleteBusiness(businessId);
        if (result.error) {
          toast.error(result.error);
          throw new Error(result.error);
        }
        toast.success("사업체를 삭제했습니다.");
      }}
    />
  );
}
