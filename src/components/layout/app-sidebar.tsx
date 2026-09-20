"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Store,
  ListChecks,
  Compass,
  BookOpen,
  Building2,
  CreditCard,
  Settings,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { signOut } from "@/app/(auth)/actions";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Automations",
    items: [
      { href: "/automations/marketplace", label: "Marketplace", icon: Store },
      { href: "/automations", label: "My Automations", icon: ListChecks, exact: true },
    ],
  },
  {
    items: [
      { href: "/directory", label: "AI Directory", icon: Compass },
      { href: "/guides", label: "Guides", icon: BookOpen },
    ],
  },
  {
    items: [
      { href: "/business", label: "Business", icon: Building2 },
      { href: "/billing", label: "Billing", icon: CreditCard },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-muted/20 md:flex md:flex-col">
      <div className="flex h-16 items-center border-b px-6">
        <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
          AutoBiz
        </Link>
      </div>
      <nav className="flex-1 space-y-6 px-3 py-6">
        {NAV_SECTIONS.map((section, index) => (
          <div key={section.label ?? index} className="space-y-1">
            {section.label ? (
              <p className="px-3 text-xs font-medium uppercase text-muted-foreground">{section.label}</p>
            ) : null}
            {section.items.map((item) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <form action={signOut} className="border-t p-3">
        <button
          type="submit"
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          로그아웃
        </button>
      </form>
    </aside>
  );
}
