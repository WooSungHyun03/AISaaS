import { Skeleton } from "@/components/ui/skeleton";

export default function AutomationHistoryLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6" role="status" aria-label="제작 기록 불러오는 중">
      <div className="space-y-3"><Skeleton className="h-9 w-40" /><Skeleton className="h-4 w-80 max-w-full" /></div>
      <div className="flex gap-2">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-9 w-20 rounded-full" />)}</div>
      <div className="space-y-px overflow-hidden rounded-2xl border bg-card">{Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-14 w-full rounded-none" />)}</div>
      <span className="sr-only">제작 기록을 불러오고 있어요.</span>
    </div>
  );
}
