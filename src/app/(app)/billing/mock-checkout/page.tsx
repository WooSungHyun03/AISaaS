import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="mx-auto max-w-md py-16">
      <Card>
        <CardHeader>
          <CardTitle>결제 시뮬레이션</CardTitle>
          <CardDescription>BILLING_PROVIDER=mock 모드입니다. 실제 결제가 이루어지지 않습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-4">
            <p className="font-medium">{planConfig.name} 플랜</p>
            <p className="text-sm text-muted-foreground">월 {planConfig.priceMonthlyKrw.toLocaleString()}원</p>
          </div>
          <MockCheckoutConfirm sessionId={checkout.id} plan={checkout.plan} />
        </CardContent>
      </Card>
    </div>
  );
}
