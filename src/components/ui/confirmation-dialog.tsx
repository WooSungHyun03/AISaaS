"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function ConfirmationDialog({
  trigger,
  title,
  description,
  confirmLabel = "확인",
  pendingLabel = "처리 중...",
  destructive = false,
  disabled = false,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  pendingLabel?: string;
  destructive?: boolean;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      try {
        await onConfirm();
        setOpen(false);
      } catch {
        // The caller owns the user-facing error message. Keep the dialog open for retry.
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isPending) setOpen(nextOpen); }}>
      <DialogTrigger asChild disabled={disabled}>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline" disabled={isPending}>취소</Button></DialogClose>
          <Button type="button" variant={destructive ? "destructive" : "default"} onClick={handleConfirm} disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
