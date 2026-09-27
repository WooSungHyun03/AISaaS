"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/app/(auth)/actions";

const MOBILE_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/automations/marketplace", label: "Marketplace" },
  { href: "/automations", label: "My Automations" },
  { href: "/automations/history", label: "Execution History" },
  { href: "/directory", label: "AI Directory" },
  { href: "/guides", label: "Guides" },
  { href: "/business", label: "Business" },
  { href: "/billing", label: "Billing" },
  { href: "/settings", label: "Settings" },
];

export function AppHeader({ email, plan }: { email: string; plan: string }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:static md:px-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-lg" className="md:hidden" aria-label="앱 메뉴 열기">
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[min(70vh,32rem)] w-64 overflow-y-auto">
          {MOBILE_LINKS.map((link) => (
            <DropdownMenuItem key={link.href} asChild>
              <Link href={link.href} aria-current={pathname === link.href || (link.href !== "/automations" && pathname.startsWith(`${link.href}/`)) ? "page" : undefined}>{link.label}</Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-3">
        <Badge variant="secondary" className="whitespace-nowrap">{plan} 플랜</Badge>
        <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
        <form action={signOut} className="md:hidden">
          <Button type="submit" variant="ghost" size="sm">
            로그아웃
          </Button>
        </form>
      </div>
    </header>
  );
}
