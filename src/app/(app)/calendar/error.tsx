"use client";

import { ErrorState } from "@/components/ui/page-state";

export default function CalendarError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorState
      title="마케팅 캘린더를 불러오지 못했습니다"
      description="캘린더 데이터와 연결 상태를 확인한 뒤 다시 시도해주세요."
      onRetry={reset}
      homeHref="/dashboard"
    />
  );
}
