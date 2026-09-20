"use client";

import { Button } from "@/components/ui/button";
import { deleteBusiness } from "@/app/(app)/business/actions";

export function DeleteBusinessButton({ businessId }: { businessId: string }) {
  return (
    <form
      action={deleteBusiness.bind(null, businessId)}
      onSubmit={(event) => {
        if (!confirm("이 사업체를 삭제하시겠습니까? 연결된 자동화도 함께 삭제됩니다.")) {
          event.preventDefault();
        }
      }}
    >
      <Button type="submit" variant="ghost" size="sm" className="text-destructive hover:text-destructive">
        삭제
      </Button>
    </form>
  );
}
