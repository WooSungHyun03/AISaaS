import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-7" role="status" aria-label="대시보드 불러오는 중">
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index}>
            <CardHeader><Skeleton className="h-4 w-28" /></CardHeader>
            <CardContent className="space-y-3"><Skeleton className="h-8 w-24" /><Skeleton className="h-3 w-36" /></CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(260px,1fr)]">
        <Card>
          <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
          <CardContent className="space-y-5">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
          </CardContent>
        </Card>
        <div className="space-y-5">
          {[0, 1].map((index) => <Card key={index}><CardContent className="space-y-4 py-4"><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></CardContent></Card>)}
        </div>
      </div>
      <span className="sr-only">대시보드 데이터를 불러오고 있습니다.</span>
    </div>
  );
}
