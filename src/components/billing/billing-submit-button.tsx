"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BillingSubmitButton({
  children,
  pendingLabel = "처리 중...",
  variant = "default",
  className,
  confirmMessage,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: "default" | "outline" | "destructive" | "secondary" | "ghost" | "link";
  className?: string;
  confirmMessage?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      className={className}
      disabled={pending}
      onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault();
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? pendingLabel : children}
    </Button>
  );
}
