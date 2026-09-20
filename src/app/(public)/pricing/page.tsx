import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequestDialog } from "@/components/pricing/setup-request-dialog";
import { ALL_PLANS } from "@/server/billing/plans";
import { createClient } from "@/lib/supabase/server";

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-5xl space-y-16 px-4 py-16">
      <section className="space-y-3 text-center">
        <h1 className="text-3xl font-bold tracking-tight">요금제</h1>
        <p className="text-muted-foreground">사업 규모에 맞는 플랜을 선택하세요. 가격은 언제든 변경될 수 있습니다.</p>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {ALL_PLANS.map((plan) => (
          <Card key={plan.id} className={plan.id === "STARTER" ? "border-primary shadow-sm" : undefined}>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between">
                <span>{plan.name}</span>
                <span className="text-2xl font-bold">
                  {plan.priceMonthlyKrw === 0 ? "무료" : `₩${plan.priceMonthlyKrw.toLocaleString()}`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button asChild className="w-full" variant={plan.id === "FREE" ? "outline" : "default"}>
                <Link href={user ? "/billing" : "/signup"}>{user ? "요금제 관리" : "무료로 시작하기"}</Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </section>

      <section id="setup-service" className="scroll-mt-20">
        <Card className="bg-muted/40">
          <CardHeader>
            <CardTitle>자동화를 직접 설정하기 어려우신가요?</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              업체 정보와 필요한 자동화만 알려주시면 전문가가 설정을 대신 해드립니다. 별도 견적으로 진행됩니다.
            </p>
            <SetupRequestDialog isAuthenticated={Boolean(user)} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
