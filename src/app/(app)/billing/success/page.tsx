import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, Gauge, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getCheckoutSession } from "@/server/billing/checkout-sessions";
import { getPlanConfig } from "@/server/billing/plans";
import { getSubscriptionForUser } from "@/server/billing/read-model";

export default async function BillingSuccessPage({ searchParams }: PageProps<"/billing/success">) {
  const { session: sessionId } = await searchParams;
  if (typeof sessionId !== "string") redirect("/billing");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Re-read both records after the provider callback. This is the source of
  // truth shown to the user, rather than optimistic client state.
  const [checkout, subscription] = await Promise.all([
    getCheckoutSession(sessionId, user.id).catch(() => null),
    getSubscriptionForUser(user.id),
  ]);
  if (!checkout || checkout.status !== "SUCCEEDED" || !subscription || subscription.status !== "ACTIVE") {
    redirect(`/billing/fail?code=SUBSCRIPTION_NOT_ACTIVE&session=${encodeURIComponent(sessionId)}`);
  }

  const plan = getPlanConfig(subscription.plan);
  return (
    <div className="mx-auto max-w-2xl py-10 sm:py-16">
      <Card className="overflow-hidden border-emerald-200">
        <div className="h-1.5 bg-emerald-500" />
        <CardHeader className="items-center text-center">
          <CheckCircle2 className="mb-2 size-12 text-emerald-600" />
          <CardTitle className="text-2xl">{plan.name} 플랜이 적용되었습니다</CardTitle>
          <p className="text-sm text-muted-foreground">구독 상태를 다시 확인했으며 지금부터 새 한도를 사용할 수 있습니다.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-4">
              <Workflow className="mb-2 size-5 text-blue-600" />
              <p className="text-sm text-muted-foreground">자동화 한도</p>
              <p className="font-semibold">최대 {plan.automationLimit}개</p>
            </div>
            <div className="rounded-xl border p-4">
              <Gauge className="mb-2 size-5 text-blue-600" />
              <p className="text-sm text-muted-foreground">월 실행 한도</p>
              <p className="font-semibold">{plan.monthlyRunLimit}회</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild><Link href="/automations/marketplace">자동화 선택하기</Link></Button>
            <Button asChild variant="outline"><Link href="/billing">Billing으로 돌아가기</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
