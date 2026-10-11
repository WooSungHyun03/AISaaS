import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Mascot } from "@/components/brand/mascot";
import { createClient } from "@/lib/supabase/server";
import { getCheckoutSession } from "@/server/billing/checkout-sessions";
import { getProductPurchaseResult } from "@/server/billing/orders";
import { getProductConfig, isProductId } from "@/server/billing/products";

export default async function BillingSuccessPage({ searchParams }: PageProps<"/billing/success">) {
  const { session: sessionId } = await searchParams;
  if (typeof sessionId !== "string") redirect("/billing");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Re-read the checkout, paid order, and grant after the provider callback. This is the source of
  // truth shown to the user, rather than optimistic client state.
  const [checkout, purchase] = await Promise.all([
    getCheckoutSession(sessionId, user.id).catch(() => null),
    getProductPurchaseResult(sessionId, user.id).catch(() => null),
  ]);
  if (!checkout || checkout.status !== "SUCCEEDED" || !purchase || purchase.order.status !== "PAID"
    || !purchase.grant || !isProductId(purchase.order.product_id)) {
    redirect(`/billing/fail?code=ORDER_NOT_PAID&session=${encodeURIComponent(sessionId)}`);
  }

  const product = getProductConfig(purchase.order.product_id);
  return (
    <div className="mx-auto max-w-xl py-8 text-center sm:py-14">
      <Mascot pose="thumbsUp" size={168} priority className="mx-auto" />
      <h1 className="mt-6 text-3xl font-extrabold tracking-[-0.04em]">{product.name} 구매가 완료됐어요</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">결제와 크레딧 지급을 다시 확인했어요. 지금부터 바로 사용할 수 있어요.</p>
      <dl className="mt-8 grid gap-px overflow-hidden rounded-2xl border bg-border text-left sm:grid-cols-2">
        <div className="bg-card px-5 py-4"><dt className="text-[13px] font-semibold text-muted-foreground">지급 크레딧</dt><dd className="tabular mt-1 text-xl font-extrabold">{purchase.grant.amount}회</dd></div>
        <div className="bg-card px-5 py-4"><dt className="text-[13px] font-semibold text-muted-foreground">사용 기한</dt><dd className="tabular mt-1 text-xl font-extrabold">{new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(purchase.grant.expires_at))}</dd></div>
      </dl>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild size="lg"><Link href="/calendar">콘텐츠 만들러 가기</Link></Button>
        <Button asChild size="lg" variant="outline"><Link href="/billing">크레딧·주문 보기</Link></Button>
      </div>
    </div>
  );
}
