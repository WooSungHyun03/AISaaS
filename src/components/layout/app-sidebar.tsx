"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { APP_NAV, getActiveNavItem } from "./nav-config";

export function AppSidebar() {
  const pathname = usePathname();
  const activeItem = getActiveNavItem(pathname);

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Logo href="/" tone="dark" />
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6 pt-3" aria-label="앱 주요 메뉴">
        {APP_NAV.map((section, index) => (
          <div key={section.label ?? index} className="space-y-0.5">
            {section.label ? (
              <p className="px-3 pb-1.5 text-xs font-semibold text-sidebar-foreground/60">{section.label}</p>
            ) : null}
            {section.items.map((item) => {
              const Icon = item.icon;
              if (item.comingSoon) {
                return (
                  <div
                    key={item.href}
                    aria-disabled="true"
                    className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-sidebar-foreground/45"
                  >
                    <Icon className="size-[18px]" aria-hidden="true" />
                    {item.label}
                    <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-sidebar-foreground/70">준비 중</span>
                  </div>
                );
              }
              const isActive = activeItem?.href === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  {isActive ? <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-spark" aria-hidden="true" /> : null}
                  <Icon className="size-[18px]" aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <Link
          href="/"
          className="flex min-h-10 items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-sidebar-foreground transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <ExternalLink className="size-[18px]" aria-hidden="true" />
          메인으로
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-[15px] font-medium text-sidebar-foreground transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <LogOut className="size-[18px]" aria-hidden="true" />
            로그아웃
          </button>
        </form>
      </div>
    </aside>
  );
}
