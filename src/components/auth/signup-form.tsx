"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUp, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/form-message";

const initialState: AuthActionState = {};

export function SignupForm({ redirectTo = "/onboarding" }: { redirectTo?: string }) {
  const [state, formAction, isPending] = useActionState(signUp, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>회원가입</CardTitle>
        <CardDescription>무료로 가입하고 사업 정보를 입력해 첫 자동화를 준비하세요.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4" aria-describedby={state.error ? "signup-error" : "signup-password-help"}>
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <div className="space-y-2">
            <Label htmlFor="displayName">이름</Label>
            <Input id="displayName" name="displayName" type="text" autoComplete="name" required maxLength={100} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">이메일</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required maxLength={320} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">비밀번호</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required aria-describedby="signup-password-help" />
            <p id="signup-password-help" className="text-xs text-muted-foreground">8자 이상 입력해주세요.</p>
          </div>
          {state.error ? <FormMessage id="signup-error">{state.error}</FormMessage> : null}
          <Button type="submit" className="w-full" disabled={isPending} aria-disabled={isPending}>
            {isPending ? "가입 중..." : "회원가입"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          이미 계정이 있으신가요?{" "}
          <Link href={`/login?redirectTo=${encodeURIComponent(redirectTo)}`} className="underline underline-offset-4">
            로그인
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
