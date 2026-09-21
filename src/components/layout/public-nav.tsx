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
  { href: "/#automations", label: "자동화" },
  { href: "/pricing", label: "요금제" },
  { href: "/pricing#setup-service", label: "구축 대행" },
  { href: "/directory", label: "AI 디렉토리" },
  { href: "/guides", label: "가이드" },
];

export function PublicNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          AutoBiz
        </Link>
        <nav className="hidden items-center gap-5 text-sm text-muted-foreground lg:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground">
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
            <Button asChild size="sm">
              <Link href="/dashboard">대시보드</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <Link href="/login">로그인</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">무료로 시작하기</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
