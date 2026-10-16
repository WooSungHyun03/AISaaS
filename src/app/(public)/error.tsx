"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/page-state";

export default function PublicError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <div className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6"><ErrorState onRetry={retry} homeHref="/" /></div>;
}
