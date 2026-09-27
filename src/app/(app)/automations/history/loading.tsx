import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AutomationHistoryLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6" role="status" aria-label="실행 이력 불러오는 중">
      <div className="space-y-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-9 w-40" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <div className="flex gap-2">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-8 w-20" />)}</div>
      <Card>
        <CardHeader><Skeleton className="h-5 w-24" /></CardHeader>
        <CardContent className="space-y-5">{Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-11 w-full" />)}</CardContent>
      </Card>
      <span className="sr-only">실행 이력을 불러오고 있습니다.</span>
    </div>
  );
}
