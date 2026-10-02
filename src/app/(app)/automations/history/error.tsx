"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/page-state";

export default function AutomationHistoryError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-10 sm:py-16">
      <ErrorState title="제작 기록을 불러오지 못했어요" description="잠시 후 다시 시도해주세요. 기록은 그대로 안전해요." onRetry={reset} />
    </div>
  );
}
