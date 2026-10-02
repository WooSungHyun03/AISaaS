import { cn } from "@/lib/utils";

/** 숫자 요약 묶음. 카드를 나누지 않고 하나의 테두리 안에서 구분선으로만 나눕니다. */
export function StatGroup({ children, className, columns = 4 }: { children: React.ReactNode; className?: string; columns?: 3 | 4 }) {
  return (
    <dl
      className={cn(
        "grid gap-px overflow-hidden rounded-xl border border-border bg-border",
        columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="bg-card px-5 py-4 sm:py-5">
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd className="tabular mt-1.5 text-2xl font-extrabold leading-tight tracking-[-0.03em]">{value}</dd>
      {hint ? <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
