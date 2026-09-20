"use client";

import Link from "next/link";
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
  { href: "/directory", label: "AI Directory" },
  { href: "/guides", label: "Guides" },
  { href: "/business", label: "Business" },
  { href: "/billing", label: "Billing" },
  { href: "/settings", label: "Settings" },
];

export function AppHeader({ email, plan }: { email: string; plan: string }) {
  return (
    <header className="flex h-16 items-center justify-between border-b px-4 md:px-6">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {MOBILE_LINKS.map((link) => (
            <DropdownMenuItem key={link.href} asChild>
              <Link href={link.href}>{link.label}</Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-3">
        <Badge variant="secondary">{plan} 플랜</Badge>
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
