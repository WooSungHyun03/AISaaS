import { Skeleton } from "@/components/ui/skeleton";

export default function UsageLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6" role="status" aria-label="이용내역 불러오는 중">
      <div className="space-y-3"><Skeleton className="h-9 w-40" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <div className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-2 lg:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}</div>
      <div className="space-y-px overflow-hidden rounded-2xl border bg-card">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-16 w-full rounded-none" />)}</div>
      <span className="sr-only">이용내역을 불러오고 있어요.</span>
    </div>
  );
}
