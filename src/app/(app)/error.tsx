"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/page-state";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-10 sm:py-16">
      <ErrorState
        title="요청한 화면을 불러오지 못했습니다"
        description="연결 상태를 확인한 뒤 다시 시도해주세요. 입력하거나 저장한 데이터는 임의로 변경되지 않습니다."
        onRetry={reset}
        homeHref="/dashboard"
      />
    </div>
  );
}
