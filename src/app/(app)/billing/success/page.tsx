import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Mascot } from "@/components/brand/mascot";
import { PLAN_LABEL } from "@/components/billing/plan-copy";
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
    <div className="mx-auto max-w-xl py-8 text-center sm:py-14">
      <Mascot pose="thumbsUp" size={168} priority className="mx-auto" />
      <h1 className="mt-6 text-3xl font-extrabold tracking-[-0.04em]">{PLAN_LABEL[plan.id]} 요금제가 시작됐어요</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">구독 상태를 다시 확인했어요. 지금부터 새 한도로 쓸 수 있어요.</p>
      <dl className="mt-8 grid gap-px overflow-hidden rounded-2xl border bg-border text-left sm:grid-cols-2">
        <div className="bg-card px-5 py-4"><dt className="text-[13px] font-semibold text-muted-foreground">블로그 글</dt><dd className="tabular mt-1 text-xl font-extrabold">월 {plan.monthlyBlogLimit}건</dd></div>
        <div className="bg-card px-5 py-4"><dt className="text-[13px] font-semibold text-muted-foreground">숏폼 영상</dt><dd className="tabular mt-1 text-xl font-extrabold">월 {plan.monthlyShortsLimit}건</dd></div>
      </dl>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild size="lg"><Link href="/automations/marketplace">콘텐츠 만들러 가기</Link></Button>
        <Button asChild size="lg" variant="outline"><Link href="/billing">요금제·결제 보기</Link></Button>
      </div>
    </div>
  );
}
