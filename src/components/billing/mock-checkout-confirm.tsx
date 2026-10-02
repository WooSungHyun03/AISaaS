"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function MockCheckoutConfirm({ sessionId, plan }: { sessionId: string; plan: "STARTER" | "PRO" }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleConfirm = () => {
    startTransition(async () => {
      const response = await fetch("/api/billing/mock/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });

      if (response.ok) {
        toast.success(`${plan === "PRO" ? "프로" : "스타터"} 요금제로 바뀌었어요.`);
        router.push(`/billing/success?session=${encodeURIComponent(sessionId)}`);
      } else {
        toast.error("결제 시뮬레이션에 실패했어요.");
      }
    });
  };

  return (
    <Button onClick={handleConfirm} disabled={isPending} size="lg" className="w-full">
      {isPending ? "처리하는 중…" : "결제 완료 처리 (모의)"}
    </Button>
  );
}
