import { Skeleton } from "@/components/ui/skeleton";

export default function MarketingLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-8" role="status" aria-label="마케팅 진단 불러오는 중">
      <div className="space-y-3"><Skeleton className="h-9 w-56" /><Skeleton className="h-5 w-full max-w-xl" /></div>
      <Skeleton className="h-56 rounded-2xl" />
      <div className="space-y-px overflow-hidden rounded-2xl border bg-card">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-16 w-full rounded-none" />)}</div>
      <span className="sr-only">불러오고 있어요.</span>
    </div>
  );
}
