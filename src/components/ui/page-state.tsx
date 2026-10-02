import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Mascot, type MascotPose } from "@/components/brand/mascot";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface PageStateProps {
  /** 지정하면 마스코트 대신 아이콘을 사용합니다. */
  icon?: React.ReactNode;
  mascot?: MascotPose | null;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
  role?: "status" | "alert";
}

export function PageState({ icon, mascot = "guide", title, description, action, className, role = "status" }: PageStateProps) {
  const showMascot = !icon && mascot;
  return (
    <div
      role={role}
      className={cn(
        "flex flex-col items-center gap-5 rounded-2xl bg-brand-soft/70 px-6 py-10 text-center sm:flex-row sm:gap-8 sm:px-10 sm:text-left",
        className,
      )}
    >
      {showMascot ? <Mascot pose={mascot} size={112} className="shrink-0 sm:w-[132px]" /> : null}
      {icon ? (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-card text-primary shadow-sm" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-bold tracking-[-0.02em]">{title}</h2>
        <p className="mt-1.5 max-w-xl text-[15px] leading-7 text-muted-foreground">{description}</p>
        {action ? <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">{action}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon, ...props }: Omit<PageStateProps, "role">) {
  return <PageState icon={icon} {...props} />;
}

export function ErrorState({
  title = "화면을 불러오지 못했어요",
  description = "일시적인 오류가 생겼어요. 잠시 후 다시 시도해주세요. 계속되면 알려주세요.",
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
      icon={<AlertCircle className="size-6 text-destructive" />}
      title={title}
      description={description}
      className="mx-auto max-w-2xl bg-destructive/[0.06]"
      action={
        <>
          {onRetry ? <Button type="button" onClick={onRetry}>다시 시도</Button> : null}
          {homeHref ? <Button asChild variant="outline"><Link href={homeHref}>홈으로 이동</Link></Button> : null}
        </>
      }
    />
  );
}

/** 라우트 전환 중에 보여주는 브랜드 로딩. 마스코트만 살짝 움직입니다. */
export function BrandLoading({ label = "불러오고 있어요" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <Mascot pose="cheer" size={104} className="mascot-bob" />
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

export function PageLoading({ cards = 4, rows = 4 }: { cards?: number; rows?: number }) {
  return (
    <div className="mx-auto max-w-6xl space-y-8" role="status" aria-live="polite" aria-label="페이지 불러오는 중">
      <div className="space-y-3">
        <Skeleton className="h-9 w-56 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 xl:grid-cols-[repeat(var(--cols),minmax(0,1fr))]" style={{ "--cols": cards } as React.CSSProperties}>
        {Array.from({ length: cards }, (_, index) => (
          <div key={index} className="space-y-3 bg-card px-5 py-5"><Skeleton className="h-4 w-24" /><Skeleton className="h-8 w-20" /></div>
        ))}
      </div>
      <div className="space-y-px overflow-hidden rounded-2xl border bg-card">
        {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-16 w-full rounded-none" />)}
      </div>
      <span className="sr-only">불러오고 있어요.</span>
    </div>
  );
}
