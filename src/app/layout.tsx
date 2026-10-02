import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const DESCRIPTION = "홈페이지나 SNS 주소만 넣으면 마케팅 상태를 진단하고, 이번 달 콘텐츠 계획과 블로그 글·숏폼 영상까지 만들어드려요.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "이지 마케팅 (Easy Marketing) — 사장님을 위한 AI 마케팅 도우미",
    template: "%s | 이지 마케팅",
  },
  description: DESCRIPTION,
  applicationName: "Easy Marketing",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "Easy Marketing",
    title: "이지 마케팅 — 사장님을 위한 AI 마케팅 도우미",
    description: DESCRIPTION,
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "Easy Marketing" }],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#0e1e45",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <a
          href="#main-content"
          className="sr-only z-[100] rounded-lg bg-card px-4 py-2.5 text-sm font-bold shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          본문으로 건너뛰기
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
