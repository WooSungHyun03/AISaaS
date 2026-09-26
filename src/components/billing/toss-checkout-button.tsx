"use client";

import Script from "next/script";
import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface TossPayment {
  requestBillingAuth(params: {
    method: "CARD";
    successUrl: string;
    failUrl: string;
    customerEmail?: string;
    customerName?: string;
  }): Promise<void>;
}

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => { payment(params: { customerKey: string }): TossPayment };
  }
}

export function TossCheckoutButton({
  clientKey,
  customerKey,
  successUrl,
  failUrl,
  customerEmail,
}: {
  clientKey: string;
  customerKey: string;
  successUrl: string;
  failUrl: string;
  customerEmail?: string;
}) {
  const [isSdkReady, setIsSdkReady] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleCheckout() {
    if (!window.TossPayments) {
      toast.error("결제 모듈을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    setIsPending(true);
    try {
      const payment = window.TossPayments(clientKey).payment({ customerKey });
      await payment.requestBillingAuth({
        method: "CARD",
        successUrl,
        failUrl,
        customerEmail,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "결제창을 열지 못했습니다.";
      toast.error(message);
      setIsPending(false);
    }
  }

  return (
    <>
      <Script
        src="https://js.tosspayments.com/v2/standard"
        strategy="afterInteractive"
        onReady={() => setIsSdkReady(true)}
        onError={() => toast.error("토스페이먼츠 SDK를 불러오지 못했습니다.")}
      />
      <Button className="w-full bg-[#3182f6] text-white hover:bg-[#1b64da]" onClick={handleCheckout} disabled={!isSdkReady || isPending}>
        {isPending ? <Loader2 className="animate-spin" /> : <CreditCard />}
        {isPending ? "결제창 여는 중..." : isSdkReady ? "카드 등록 후 테스트 결제" : "결제 모듈 준비 중..."}
      </Button>
    </>
  );
}
