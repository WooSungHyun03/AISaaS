"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { requestPasswordReset, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/ui/form-message";

const initialState: AuthActionState = {};

export function ForgotPasswordForm() {
  const linkError = useSearchParams().get("linkError") === "1";
  const [state, formAction, isPending] = useActionState(requestPasswordReset, initialState);

  return (
    <div>
      <h1 className="text-[1.75rem] font-extrabold tracking-[-0.035em]">비밀번호를 잊으셨나요?</h1>
      <p className="mt-2 text-[15px] leading-7 text-muted-foreground">가입한 이메일을 입력하면 새 비밀번호를 만들 수 있는 링크를 보내드려요.</p>

      {linkError && !state.success ? (
        <FormMessage className="mt-6">재설정 링크가 만료됐거나 이미 사용됐어요. 새 링크를 다시 받아주세요.</FormMessage>
      ) : null}

      {state.success ? (
        <FormMessage variant="success" className="mt-8">
          입력한 주소로 가입된 계정이 있으면 재설정 링크를 보냈어요. 메일이 보이지 않으면 스팸함도 확인해주세요. 링크는 한 번만 쓸 수 있어요.
        </FormMessage>
      ) : (
        <form action={formAction} className="mt-8 space-y-5" aria-describedby={state.error ? "forgot-error" : undefined}>
          <div className="space-y-2">
            <Label htmlFor="email">이메일</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required maxLength={320} autoFocus placeholder="name@example.com" />
          </div>
          {state.error ? <FormMessage id="forgot-error">{state.error}</FormMessage> : null}
          <Button type="submit" size="lg" className="w-full" disabled={isPending} aria-disabled={isPending}>
            {isPending ? "보내는 중…" : "재설정 링크 받기"}
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        비밀번호가 기억나셨나요?{" "}
        <Link href="/login" className="font-semibold text-primary underline-offset-4 hover:underline">로그인</Link>
      </p>
    </div>
  );
}
