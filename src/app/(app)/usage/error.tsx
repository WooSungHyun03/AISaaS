"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/page-state";

export default function UsageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-10 sm:py-16">
      <ErrorState title="이용내역을 불러오지 못했어요" description="잠시 후 다시 시도해주세요. 이용내역은 그대로 안전해요." onRetry={reset} />
    </div>
  );
}
