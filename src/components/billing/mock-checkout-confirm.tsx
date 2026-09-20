"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function MockCheckoutConfirm({ userId, plan }: { userId: string; plan: "STARTER" | "PRO" }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleConfirm = () => {
    startTransition(async () => {
      const response = await fetch("/api/billing/webhook", {
        method: "POST",
        body: JSON.stringify({ type: "checkout.completed", userId, plan }),
      });

      if (response.ok) {
        toast.success(`${plan} 플랜으로 업그레이드되었습니다.`);
        router.push("/billing");
      } else {
        toast.error("결제 시뮬레이션에 실패했습니다.");
      }
    });
  };

  return (
    <Button onClick={handleConfirm} disabled={isPending} className="w-full">
      {isPending ? "처리 중..." : "결제 완료 처리 (Mock)"}
    </Button>
  );
}
