"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { changePassword, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/ui/form-message";
import { NewPasswordFields } from "@/components/auth/new-password-fields";

const initialState: AuthActionState = {};

export function PasswordForm() {
  const [state, formAction, isPending] = useActionState(changePassword, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.success) return;
    toast.success("비밀번호를 바꿨어요.");
    formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="max-w-md space-y-5" aria-describedby={state.error ? "password-form-error" : undefined}>
      <div className="space-y-2">
        <Label htmlFor="current-password">현재 비밀번호</Label>
        <Input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
      </div>
      <NewPasswordFields idPrefix="settings" />
      {state.error ? <FormMessage id="password-form-error">{state.error}</FormMessage> : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? "바꾸는 중…" : "비밀번호 바꾸기"}
      </Button>
    </form>
  );
}
