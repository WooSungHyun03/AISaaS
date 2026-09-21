"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUp, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: AuthActionState = {};

export function SignupForm({ redirectTo = "/dashboard" }: { redirectTo?: string }) {
  const [state, formAction, isPending] = useActionState(signUp, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>회원가입</CardTitle>
        <CardDescription>무료로 시작하고 첫 자동화를 만들어보세요.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <div className="space-y-2">
            <Label htmlFor="displayName">이름</Label>
            <Input id="displayName" name="displayName" type="text" autoComplete="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">이메일</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">비밀번호</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" className="w-full" disabled={isPending}>
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
