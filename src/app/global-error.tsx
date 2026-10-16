"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/page-state";
import "./globals.css";

/**
 * Last-resort boundary for errors in the root layout and in route groups without their own error.tsx
 * ((admin), (auth)). It replaces the root layout, so it renders its own <html>/<body> and stylesheet.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <title>오류가 발생했어요 | 이지 마케팅</title>
        <main className="mx-auto w-full max-w-7xl px-4 py-20 sm:px-6">
          <ErrorState onRetry={retry} homeHref="/" />
        </main>
      </body>
    </html>
  );
}
