import { redirect } from "next/navigation";
import { FormMessage } from "@/components/ui/form-message";
import { PLAN_LABEL } from "@/components/billing/plan-copy";
import { MockCheckoutConfirm } from "@/components/billing/mock-checkout-confirm";
import { getPlanConfig } from "@/server/billing/plans";
import { createClient } from "@/lib/supabase/server";
import { getCheckoutSession } from "@/server/billing/checkout-sessions";

export default async function MockCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session: sessionId } = await searchParams;
  if (!sessionId) redirect("/billing");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const checkout = await getCheckoutSession(sessionId, user.id).catch(() => null);
  if (!checkout || checkout.provider !== "mock") redirect("/billing");

  const planConfig = getPlanConfig(checkout.plan);

  return (
    <div className="mx-auto max-w-md space-y-5 py-10 sm:py-16">
      <h1 className="text-2xl font-extrabold tracking-[-0.04em]">결제 시뮬레이션</h1>
      <FormMessage variant="info">모의 결제 모드예요. 실제로 결제되지 않아요.</FormMessage>
      <div className="rounded-2xl border bg-card px-5 py-4">
        <p className="font-bold">{PLAN_LABEL[checkout.plan]} 요금제</p>
        <p className="tabular text-sm text-muted-foreground">월 {planConfig.priceMonthlyKrw.toLocaleString()}원</p>
      </div>
      <MockCheckoutConfirm sessionId={checkout.id} plan={checkout.plan} />
    </div>
  );
}
