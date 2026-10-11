import Link from "next/link";
import { ArrowLeft, LayoutDashboard, MessageCircleQuestion, ShieldCheck } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

const ADMIN_NAV = [
  { href: "/admin", label: "대시보드", icon: LayoutDashboard },
  { href: "/admin/inquiries", label: "고객 문의", icon: MessageCircleQuestion },
] as const;

export function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/35">
      <header className="border-b bg-ink text-white">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3"><Logo href="/admin" size="sm" tone="dark" /><span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold"><ShieldCheck className="size-3.5" aria-hidden="true" />관리자</span></div>
            <Button asChild variant="ghost" size="sm" className="text-white hover:bg-white/10 hover:text-white lg:hidden"><Link href="/"><ArrowLeft aria-hidden="true" />서비스</Link></Button>
          </div>
          <nav className="flex flex-1 gap-1 overflow-x-auto" aria-label="관리자 메뉴">
            {ADMIN_NAV.map((item) => <Button key={item.href} asChild variant="ghost" size="sm" className="text-white/80 hover:bg-white/10 hover:text-white"><Link href={item.href}><item.icon aria-hidden="true" />{item.label}</Link></Button>)}
          </nav>
          <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3 text-xs text-white/70 lg:border-0 lg:pt-0">
            <span className="max-w-52 truncate">{email}</span>
            <Button asChild variant="ghost" size="sm" className="hidden text-white/80 hover:bg-white/10 hover:text-white lg:inline-flex"><Link href="/"><ArrowLeft aria-hidden="true" />서비스로</Link></Button>
            <form action={signOut}><Button type="submit" variant="outline" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">로그아웃</Button></form>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1440px] px-4 py-7 sm:px-6 lg:px-8 lg:py-10">{children}</main>
    </div>
  );
}

