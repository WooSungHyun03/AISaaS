import Link from "next/link";
import { ShortsLibraryCard } from "@/components/shorts/library-card";
import type { ShortsLibraryItem } from "@/server/shorts/library";

/** The newest saved videos, shown under the studio's preview, with a way into the whole library. */
export function RecentShorts({ items, total }: { items: ShortsLibraryItem[]; total: number }) {
  const count = `${total}개 저장됨`;
  return (
    <section aria-labelledby="recent-videos-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="recent-videos-heading" className="text-lg font-extrabold tracking-[-0.03em]">최근 만든 영상 <span className="text-sm font-medium text-muted-foreground">{count}</span></h2>
        <Link href="/shorts/library" className="text-sm font-semibold text-primary underline underline-offset-2">내 영상 전체 보기</Link>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">{items.map((item) => <ShortsLibraryCard key={item.id} item={item} />)}</ul>
    </section>
  );
}
