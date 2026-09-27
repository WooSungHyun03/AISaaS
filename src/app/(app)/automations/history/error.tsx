"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/page-state";

export default function AutomationHistoryError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-10 sm:py-16">
      <ErrorState title="실행 이력을 불러오지 못했습니다" description="잠시 후 다시 시도해주세요. 실행 데이터는 변경되지 않았습니다." onRetry={reset} />
    </div>
  );
}
