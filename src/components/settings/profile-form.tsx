"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/ui/form-message";
import { updateProfile, type SettingsActionState } from "@/app/(app)/settings/actions";

const initialState: SettingsActionState = {};

export function ProfileForm({ email, displayName }: { email: string; displayName: string | null }) {
  const [state, formAction, isPending] = useActionState(updateProfile, initialState);

  useEffect(() => {
    if (state.success) toast.success("프로필을 저장했습니다.");
  }, [state]);

  return (
    <form action={formAction} className="space-y-4" aria-describedby={state.error ? "profile-form-error" : undefined}>
      <div className="space-y-2">
        <Label htmlFor="email">이메일</Label>
        <Input id="email" value={email} disabled aria-describedby="email-readonly-help" />
        <p id="email-readonly-help" className="text-xs text-muted-foreground">로그인 이메일은 이 화면에서 변경할 수 없습니다.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="displayName">이름</Label>
        <Input id="displayName" name="displayName" defaultValue={displayName ?? ""} maxLength={100} autoComplete="name" />
      </div>
      {state.error ? <FormMessage id="profile-form-error">{state.error}</FormMessage> : null}
      {state.success ? <FormMessage variant="success">저장되었습니다.</FormMessage> : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? "저장 중..." : "저장"}
      </Button>
    </form>
  );
}
