"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/ui/form-message";

const initialState: AuthActionState = {};

export function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";
  const checkEmail = searchParams.get("checkEmail") === "1";
  const [state, formAction, isPending] = useActionState(signIn, initialState);

  return (
    <div>
      <h1 className="text-[1.75rem] font-extrabold tracking-[-0.035em]">다시 오셨네요, 반가워요</h1>
      <p className="mt-2 text-[15px] leading-7 text-muted-foreground">로그인하고 마케팅 계획을 이어서 확인하세요.</p>

      {checkEmail ? (
        <FormMessage variant="info" className="mt-6">
          가입하신 이메일로 인증 링크를 보냈어요. 인증을 마친 뒤 로그인하면 사업 정보 입력으로 이어집니다.
        </FormMessage>
      ) : null}

      <form action={formAction} className="mt-8 space-y-5" aria-describedby={state.error ? "login-error" : undefined}>
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <div className="space-y-2">
          <Label htmlFor="email">이메일</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required maxLength={320} autoFocus placeholder="name@example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">비밀번호</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} maxLength={128} />
        </div>
        {state.error ? <FormMessage id="login-error">{state.error}</FormMessage> : null}
        <Button type="submit" size="lg" className="w-full" disabled={isPending} aria-disabled={isPending}>
          {isPending ? "로그인하는 중…" : "로그인"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        아직 계정이 없으신가요?{" "}
        <Link href={`/signup?redirectTo=${encodeURIComponent(redirectTo)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
          무료로 시작하기
        </Link>
      </p>
    </div>
  );
}
