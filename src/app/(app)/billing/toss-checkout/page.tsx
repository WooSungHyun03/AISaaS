import { redirect } from "next/navigation";
import { FormMessage } from "@/components/ui/form-message";
import { PLAN_LABEL } from "@/components/billing/plan-copy";
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
    <div className="mx-auto max-w-lg space-y-5 py-10 sm:py-16">
      <div>
        <h1 className="text-2xl font-extrabold tracking-[-0.04em]">{PLAN_LABEL[checkout.plan]} 요금제 시작하기</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">카드를 등록하면 첫 달 결제가 진행돼요.</p>
      </div>
      <FormMessage variant="info">테스트 결제 환경이에요. 실제 카드 청구는 없어요.</FormMessage>
      <div className="rounded-2xl border bg-card px-5 py-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-bold">{PLAN_LABEL[checkout.plan]} 요금제</p>
          <p className="tabular text-xl font-extrabold">월 {plan.priceMonthlyKrw.toLocaleString()}원</p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">만들기 설정 {plan.automationLimit}개 · 월 {plan.monthlyRunLimit}회 제작</p>
      </div>
      <TossCheckoutButton
        clientKey={clientKey}
        customerKey={checkout.customer_key}
        successUrl={successUrl.toString()}
        failUrl={failUrl.toString()}
        customerEmail={user.email}
      />
      <p className="text-center text-[13px] leading-6 text-muted-foreground">
        버튼을 누르면 토스페이먼츠의 안전한 카드 등록창으로 이동해요.
      </p>
    </div>
  );
}
