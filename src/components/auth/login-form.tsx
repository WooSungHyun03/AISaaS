"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, type AuthActionState } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const initialState: AuthActionState = {};

export function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";
  const checkEmail = searchParams.get("checkEmail") === "1";
  const [state, formAction, isPending] = useActionState(signIn, initialState);

  return (
    <Card>
      <CardHeader>
        <CardTitle>로그인</CardTitle>
        <CardDescription>계정에 로그인하고 자동화를 관리하세요.</CardDescription>
      </CardHeader>
      <CardContent>
        {checkEmail ? (
          <p role="status" className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm leading-5 text-blue-800">
            가입한 이메일의 인증 링크를 확인해주세요. 인증 후 로그인하면 사업 정보 설정으로 이어집니다.
          </p>
        ) : null}
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <div className="space-y-2">
            <Label htmlFor="email">이메일</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">비밀번호</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? "로그인 중..." : "로그인"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          계정이 없으신가요?{" "}
          <Link href={`/signup?redirectTo=${encodeURIComponent(redirectTo)}`} className="underline underline-offset-4">
            회원가입
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
