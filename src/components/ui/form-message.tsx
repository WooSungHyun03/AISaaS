import { CheckCircle2, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function FormMessage({
  id,
  children,
  variant = "error",
  className,
}: {
  id?: string;
  children: React.ReactNode;
  variant?: "error" | "success";
  className?: string;
}) {
  const Icon = variant === "error" ? CircleAlert : CheckCircle2;
  return (
    <p
      id={id}
      role={variant === "error" ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-5",
        variant === "error" ? "border-destructive/25 bg-destructive/5 text-destructive" : "border-emerald-200 bg-emerald-50 text-emerald-800",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
