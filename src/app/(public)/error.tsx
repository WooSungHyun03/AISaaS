"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/page-state";

export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6"><ErrorState onRetry={reset} homeHref="/" /></div>;
}
