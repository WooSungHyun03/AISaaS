"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/page-state";

export default function RefundRequestsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <div className="py-10 sm:py-16"><ErrorState title="환불 요청을 불러오지 못했어요" description="잠시 후 다시 시도해주세요. 저장된 요청은 그대로 유지돼요." onRetry={reset} homeHref="/billing" /></div>;
}

