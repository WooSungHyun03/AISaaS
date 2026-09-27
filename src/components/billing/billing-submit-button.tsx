"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

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
  const buttonRef = useRef<HTMLButtonElement>(null);

  if (confirmMessage) {
    return (
      <ConfirmationDialog
        trigger={
          <Button ref={buttonRef} type="button" variant={variant} className={className} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {pending ? pendingLabel : children}
          </Button>
        }
        title="변경 내용을 확인해주세요"
        description={confirmMessage}
        confirmLabel="변경 계속하기"
        pendingLabel={pendingLabel}
        destructive={variant === "destructive"}
        disabled={pending}
        onConfirm={() => buttonRef.current?.form?.requestSubmit()}
      />
    );
  }

  return (
    <Button
      type="submit"
      variant={variant}
      className={className}
      disabled={pending}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {pending ? pendingLabel : children}
    </Button>
  );
}
