"use client";

import { useActionState, useState } from "react";
import { deleteAccount, type AuthActionState } from "@/app/(auth)/actions";
import { ACCOUNT_DELETE_CONFIRMATION } from "@/lib/auth-validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/ui/form-message";

const initialState: AuthActionState = {};

export function DeleteAccountForm() {
  const [state, formAction, isPending] = useActionState(deleteAccount, initialState);
  const [confirmation, setConfirmation] = useState("");

  return (
    <form action={formAction} className="max-w-md space-y-5" aria-describedby={state.error ? "delete-account-error" : undefined}>
      <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
        <li>사업 정보, 진단·캘린더, 만든 블로그·숏폼, 이용·결제 기록, 외부 서비스 연결이 모두 삭제돼요.</li>
        <li>삭제한 계정과 데이터는 되돌릴 수 없어요. 필요한 글은 먼저 복사해두세요.</li>
        <li>남은 이용 횟수는 사라지고 환불되지 않아요. 환불이 필요하면 탈퇴 전에 문의해주세요.</li>
      </ul>
      <div className="space-y-2">
        <Label htmlFor="delete-current-password">현재 비밀번호</Label>
        <Input id="delete-current-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="delete-confirmation">확인을 위해 &lsquo;{ACCOUNT_DELETE_CONFIRMATION}&rsquo;를 입력해주세요</Label>
        <Input
          id="delete-confirmation"
          name="confirmation"
          autoComplete="off"
          required
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </div>
      {state.error ? <FormMessage id="delete-account-error">{state.error}</FormMessage> : null}
      <Button type="submit" variant="destructive" disabled={isPending || confirmation.trim() !== ACCOUNT_DELETE_CONFIRMATION}>
        {isPending ? "삭제하는 중…" : "계정 영구 삭제"}
      </Button>
    </form>
  );
}
