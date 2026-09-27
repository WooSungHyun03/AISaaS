import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AutoBiz — 업무 자동화 SaaS",
  description: "사업 정보를 등록하면 AI가 마케팅/고객응대 업무를 반복 자동화합니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a href="#main-content" className="sr-only z-[100] rounded-md bg-background px-4 py-2 text-sm font-semibold shadow focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          본문으로 건너뛰기
        </a>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
