import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** 브라우저 기본 select(모바일에서 편한 피커)를 서비스 입력창과 같은 모양으로 맞춘 것. */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="native-select"
        className={cn(
          "h-11 w-full cursor-pointer appearance-none rounded-lg border border-input bg-card pr-10 pl-3.5 text-base outline-none transition-colors focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 md:text-[15px]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

export { NativeSelect };
