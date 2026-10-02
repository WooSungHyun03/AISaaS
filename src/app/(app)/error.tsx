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
        title="화면을 불러오지 못했어요"
        description="인터넷 연결을 확인하고 다시 시도해주세요. 입력하신 내용은 그대로 안전해요."
        onRetry={reset}
        homeHref="/dashboard"
      />
    </div>
  );
}
