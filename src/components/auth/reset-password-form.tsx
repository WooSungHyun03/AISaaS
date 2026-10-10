"use client";

import { useActionState } from "react";
import Link from "next/link";
import { completePasswordReset, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { NewPasswordFields } from "./new-password-fields";

const initialState: AuthActionState = {};

export function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState(completePasswordReset, initialState);

  return (
    <div>
      <h1 className="text-[1.75rem] font-extrabold tracking-[-0.035em]">새 비밀번호 만들기</h1>
      <p className="mt-2 text-[15px] leading-7 text-muted-foreground">앞으로 로그인할 때 쓸 비밀번호를 입력해주세요.</p>

      {state.success ? (
        <div className="mt-8 space-y-5">
          <FormMessage variant="success">비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 사용해주세요.</FormMessage>
          <Button asChild size="lg" className="w-full"><Link href="/dashboard">대시보드로 가기</Link></Button>
        </div>
      ) : (
        <form action={formAction} className="mt-8 space-y-5" aria-describedby={state.error ? "reset-error" : undefined}>
          <NewPasswordFields idPrefix="reset" />
          {state.error ? (
            <FormMessage id="reset-error">
              {state.error}{" "}
              {state.error.includes("만료") ? <Link href="/forgot-password" className="font-semibold underline">링크 다시 받기</Link> : null}
            </FormMessage>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={isPending} aria-disabled={isPending}>
            {isPending ? "바꾸는 중…" : "비밀번호 바꾸기"}
          </Button>
        </form>
      )}
    </div>
  );
}
