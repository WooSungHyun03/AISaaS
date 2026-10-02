"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUp, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/ui/form-message";

const initialState: AuthActionState = {};

export function SignupForm({ redirectTo = "/onboarding" }: { redirectTo?: string }) {
  const [state, formAction, isPending] = useActionState(signUp, initialState);

  return (
    <div>
      <h1 className="text-[1.75rem] font-extrabold tracking-[-0.035em]">무료로 시작해요</h1>
      <p className="mt-2 text-[15px] leading-7 text-muted-foreground">
        가입한 뒤 홈페이지나 SNS 주소를 알려주시면 마케팅 진단부터 해드려요.
      </p>

      <form action={formAction} className="mt-8 space-y-5" aria-describedby={state.error ? "signup-error" : "signup-password-help"}>
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <div className="space-y-2">
          <Label htmlFor="displayName">이름</Label>
          <Input id="displayName" name="displayName" type="text" autoComplete="name" required maxLength={100} autoFocus placeholder="홍길동" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">이메일</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required maxLength={320} placeholder="name@example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">비밀번호</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required aria-describedby="signup-password-help" />
          <p id="signup-password-help" className="text-[13px] text-muted-foreground">8자 이상으로 입력해주세요.</p>
        </div>
        {state.error ? <FormMessage id="signup-error">{state.error}</FormMessage> : null}
        <Button type="submit" size="lg" className="w-full" disabled={isPending} aria-disabled={isPending}>
          {isPending ? "가입하는 중…" : "무료로 가입하기"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        이미 계정이 있으신가요?{" "}
        <Link href={`/login?redirectTo=${encodeURIComponent(redirectTo)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
          로그인
        </Link>
      </p>
    </div>
  );
}
