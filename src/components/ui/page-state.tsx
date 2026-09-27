import Link from "next/link";
import { AlertCircle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface PageStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
  role?: "status" | "alert";
}

export function PageState({ icon, title, description, action, className, role = "status" }: PageStateProps) {
  return (
    <div
      role={role}
      className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-5 py-12 text-center", className)}
    >
      {icon ? <span className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">{icon}</span> : null}
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ icon = <Inbox className="size-5" />, ...props }: Omit<PageStateProps, "role">) {
  return <PageState icon={icon} {...props} />;
}

export function ErrorState({
  title = "화면을 불러오지 못했습니다",
  description = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
  onRetry,
  homeHref,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  homeHref?: string;
}) {
  return (
    <PageState
      role="alert"
      icon={<AlertCircle className="size-5 text-destructive" />}
      title={title}
      description={description}
      className="mx-auto max-w-2xl border-destructive/20 bg-destructive/5"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {onRetry ? <Button type="button" onClick={onRetry}>다시 시도</Button> : null}
          {homeHref ? <Button asChild variant="outline"><Link href={homeHref}>안전한 화면으로 이동</Link></Button> : null}
        </div>
      }
    />
  );
}

export function PageLoading({ cards = 4, rows = 4 }: { cards?: number; rows?: number }) {
  return (
    <div className="mx-auto max-w-6xl space-y-7" role="status" aria-live="polite" aria-label="페이지 불러오는 중">
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-56 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: cards }, (_, index) => (
          <Card key={index}>
            <CardHeader><Skeleton className="h-5 w-28" /></CardHeader>
            <CardContent className="space-y-3"><Skeleton className="h-8 w-24" /><Skeleton className="h-3 w-full" /></CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
        </CardContent>
      </Card>
      <span className="sr-only">데이터를 불러오고 있습니다.</span>
    </div>
  );
}
