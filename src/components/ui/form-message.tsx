import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function FormMessage({
  id,
  children,
  variant = "error",
  className,
}: {
  id?: string;
  children: React.ReactNode;
  variant?: "error" | "success" | "info";
  className?: string;
}) {
  const Icon = variant === "error" ? CircleAlert : variant === "success" ? CheckCircle2 : Info;
  return (
    <p
      id={id}
      role={variant === "error" ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm leading-6",
        variant === "error" && "bg-destructive/[0.08] text-destructive",
        variant === "success" && "bg-success-soft text-success",
        variant === "info" && "bg-brand-soft text-secondary-foreground",
        className,
      )}
    >
      <Icon className="mt-1 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
