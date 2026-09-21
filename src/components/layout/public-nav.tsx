"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV_LINKS = [
  { href: "/#explore", label: "AI 발견" },
  { href: "/directory", label: "AI 서비스" },
  { href: "/#automations", label: "자동화" },
  { href: "/pricing", label: "요금제" },
];

export function PublicNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-[#fbfaf7]/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-lg font-black tracking-[-0.04em] text-stone-950">
          AutoBiz
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium text-stone-600 lg:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-blue-600">
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="메뉴 열기">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {NAV_LINKS.map((link) => (
                <DropdownMenuItem key={link.href} asChild>
                  <Link href={link.href}>{link.label}</Link>
                </DropdownMenuItem>
              ))}
              {!isAuthenticated ? (
                <DropdownMenuItem asChild className="sm:hidden">
                  <Link href="/login">로그인</Link>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {isAuthenticated ? (
              <Button asChild size="sm" className="rounded-lg bg-blue-600 hover:bg-blue-700">
                <Link href="/dashboard">대시보드</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">로그인</Link>
              </Button>
              <Button asChild size="sm" className="hidden rounded-lg bg-blue-600 hover:bg-blue-700 sm:inline-flex">
                <Link href="/signup">무료로 시작하기</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
