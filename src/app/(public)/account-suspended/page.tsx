import { Ban } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export const metadata = { title: "계정 이용 정지" };
export default function AccountSuspendedPage() {
  return <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4"><section className="w-full max-w-lg rounded-3xl border bg-card p-8 text-center shadow-sm"><Logo href="/" size="md" /><span className="mx-auto mt-8 flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><Ban className="size-7" aria-hidden="true" /></span><h1 className="mt-5 text-2xl font-extrabold">계정 이용이 정지되었습니다</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">새 로그인과 서비스 이용이 차단된 상태입니다. 자세한 사유와 해제 요청은 서비스 관리자에게 문의해주세요.</p><form action={signOut} className="mt-7"><Button type="submit" variant="outline" className="w-full">로그아웃</Button></form></section></main>;
}
