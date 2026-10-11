import { DashboardSectionSkeleton } from "@/components/dashboard/dashboard-sections";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-8" role="status" aria-label="대시보드 불러오는 중">
      <div className="space-y-3"><Skeleton className="h-9 w-56 max-w-full" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <DashboardSectionSkeleton className="min-h-48" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,1fr)]">
        {Array.from({ length: 6 }, (_, index) => <DashboardSectionSkeleton key={index} />)}
      </div>
      <span className="sr-only">대시보드를 불러오고 있어요.</span>
    </div>
  );
}
