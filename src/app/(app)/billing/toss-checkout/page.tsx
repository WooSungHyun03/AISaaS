import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TossCheckoutButton } from "@/components/billing/toss-checkout-button";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env/client";
import { getCheckoutSession } from "@/server/billing/checkout-sessions";
import { getPlanConfig } from "@/server/billing/plans";

export default async function TossCheckoutPage({ searchParams }: PageProps<"/billing/toss-checkout">) {
  const { session: sessionId } = await searchParams;
  if (typeof sessionId !== "string") redirect("/billing");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const checkout = await getCheckoutSession(sessionId, user.id).catch(() => null);
  if (!checkout || checkout.provider !== "toss") redirect("/billing");
  if (checkout.status === "SUCCEEDED") redirect(`/billing/success?session=${checkout.id}`);
  if (checkout.status === "CANCELED") redirect("/billing/fail?code=PAY_PROCESS_CANCELED");

  const clientKey = clientEnv.NEXT_PUBLIC_TOSS_CLIENT_KEY;
  if (!clientKey || !clientKey.startsWith("test_")) {
    redirect("/billing/fail?code=MISSING_API_KEY&message=Toss%20test%20client%20key%20is%20not%20configured");
  }

  const plan = getPlanConfig(checkout.plan);
  const successUrl = new URL("/api/billing/toss/success", clientEnv.NEXT_PUBLIC_SITE_URL);
  successUrl.searchParams.set("session", checkout.id);
  const failUrl = new URL("/api/billing/toss/fail", clientEnv.NEXT_PUBLIC_SITE_URL);
  failUrl.searchParams.set("session", checkout.id);

  return (
    <div className="mx-auto max-w-lg py-10 sm:py-16">
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
        <ShieldCheck className="size-4" />
        테스트 결제 환경 · 실제 카드 청구는 발생하지 않습니다.
      </div>
      <Card>
        <CardHeader>
          <CardTitle>토스페이먼츠로 구독 시작</CardTitle>
          <CardDescription>카드를 등록한 뒤 첫 달 테스트 결제를 승인합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-xl border bg-muted/30 p-4">
            <div className="flex items-baseline justify-between gap-4">
              <p className="font-semibold">{plan.name} 플랜</p>
              <p className="text-xl font-bold">월 ₩{plan.priceMonthlyKrw.toLocaleString()}</p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              자동화 {plan.automationLimit}개 · 월 {plan.monthlyRunLimit}회 실행
            </p>
          </div>
          <TossCheckoutButton
            clientKey={clientKey}
            customerKey={checkout.customer_key}
            successUrl={successUrl.toString()}
            failUrl={failUrl.toString()}
            customerEmail={user.email}
          />
          <p className="text-center text-xs leading-5 text-muted-foreground">
            결제 버튼을 누르면 토스페이먼츠의 안전한 카드 등록창으로 이동합니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
