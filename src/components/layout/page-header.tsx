import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** 상위 화면으로 돌아가는 링크 */
  back?: { href: string; label: string };
  className?: string;
}

/** 앱 화면 공통 머리말. 제목 1개(h1) + 한 줄 설명 + 우측 행동 버튼. */
export function PageHeader({ title, description, actions, back, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 max-w-2xl">
        {back ? (
          <Link href={back.href} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden="true" /> {back.label}
          </Link>
        ) : null}
        <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-[-0.04em] sm:text-[2rem]">{title}</h1>
        {description ? <p className="mt-2 text-[15px] leading-7 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
