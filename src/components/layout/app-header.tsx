"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/app/(auth)/actions";
import { APP_NAV, isNavActive } from "./nav-config";

const PLAN_LABEL: Record<string, string> = { FREE: "무료 플랜", STARTER: "스타터 플랜", PRO: "프로 플랜" };

export function AppHeader({ email, plan }: { email: string; plan: string }) {
  const pathname = usePathname();
  const initial = (email.trim()[0] ?? "?").toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-card/90 px-4 backdrop-blur-md md:px-8">
      <div className="flex items-center gap-2 md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="메뉴 열기">
              <Menu className="size-5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[min(75vh,34rem)] w-64 overflow-y-auto">
            {APP_NAV.map((section, index) => (
              <div key={section.label ?? index}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                {section.label ? <DropdownMenuLabel>{section.label}</DropdownMenuLabel> : null}
                {section.items.map((item) =>
                  item.comingSoon ? (
                    <DropdownMenuItem key={item.href} disabled>
                      {item.label} <span className="ml-auto text-xs text-muted-foreground">준비 중</span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link href={item.href} aria-current={isNavActive(pathname, item) ? "page" : undefined}>
                        <item.icon aria-hidden="true" /> {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ),
                )}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Logo href="/dashboard" size="sm" />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Link
          href="/billing"
          className="inline-flex h-9 items-center rounded-full bg-brand-soft px-3.5 text-[13px] font-semibold text-primary transition-colors hover:bg-accent"
        >
          {PLAN_LABEL[plan] ?? plan}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="내 계정 메뉴"
              className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-ink text-sm font-bold text-white transition-opacity hover:opacity-90"
            >
              {initial}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="truncate text-sm font-medium text-foreground">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href="/settings">설정</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/billing">요금제·결제</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action={signOut}>
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full">로그아웃</button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
