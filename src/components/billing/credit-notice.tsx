import Link from "next/link";
import { CalendarClock, Clapperboard, FileText, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CreditKind } from "@/server/billing/products";

const KIND = {
  BLOG: { label: "블로그 이용권", noun: "글", Icon: FileText },
  SHORTS: { label: "숏폼 이용권", noun: "영상", Icon: Clapperboard },
} as const;

const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" });

/**
 * Shows what a generation will cost before the owner presses the button, and
 * what is left afterwards. The server is the real gate (the runner reserves a
 * credit); this only keeps the owner from being surprised by a refusal.
 */
export function CreditNotice({ kind, remaining, nextExpiry }: { kind: CreditKind; remaining: number; nextExpiry: string | null }) {
  const { label, noun, Icon } = KIND[kind];
  if (remaining <= 0) {
    return (
      <div role="status" className="flex flex-col gap-3 rounded-2xl border border-dashed bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Ticket className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-bold">{label}이 없어요</p>
            <p className="mt-0.5 text-sm text-muted-foreground">이용권을 구매하면 {noun} 한 건을 만들 때마다 1회씩 차감돼요. 만들다가 실패하면 자동으로 돌려드려요.</p>
          </div>
        </div>
        <Button asChild size="sm"><Link href="/billing">이용권 구매하기</Link></Button>
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border bg-card px-5 py-3 text-sm">
      <span className="flex items-center gap-2 font-bold"><Icon className="size-4" aria-hidden="true" />{label} {remaining}회 남음</span>
      {nextExpiry ? <span className="flex items-center gap-1.5 text-muted-foreground"><CalendarClock className="size-3.5" aria-hidden="true" />가장 빠른 만료 {dateFormat.format(new Date(nextExpiry))}</span> : null}
      <span className="text-muted-foreground">{noun} 한 건을 만들면 1회 차감돼요 (실패하면 돌려드려요)</span>
      <Link href="/billing" className="ml-auto font-semibold text-primary underline underline-offset-2">추가 구매</Link>
    </div>
  );
}
