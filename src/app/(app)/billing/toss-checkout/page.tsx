import { redirect } from "next/navigation";
import { FormMessage } from "@/components/ui/form-message";
import { TossCheckoutButton } from "@/components/billing/toss-checkout-button";
import { getAuthUser } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env/client";
import { tossClientKey } from "@/server/billing/toss-keys";
import { getCheckoutSession } from "@/server/billing/checkout-sessions";
import { getProductConfig, isProductId } from "@/server/billing/products";
import { getProductOrderByCheckoutSession } from "@/server/billing/orders";

export default async function TossCheckoutPage({ searchParams }: PageProps<"/billing/toss-checkout">) {
  const { session: sessionId } = await searchParams;
  if (typeof sessionId !== "string") redirect("/billing");

  const user = await getAuthUser();
  if (!user) redirect("/login");

  const checkout = await getCheckoutSession(sessionId, user.id).catch(() => null);
  if (!checkout || checkout.provider !== "toss") redirect("/billing");
  if (checkout.status === "SUCCEEDED") redirect(`/billing/success?session=${checkout.id}`);
  if (checkout.status === "CANCELED") redirect("/billing/fail?code=PAY_PROCESS_CANCELED");

  // The key may be stored as NEXT_PUBLIC_TOSS_CLIENT_KEY or TOSS_CLIENT_KEY; either way the checkout needs a test key.
  const clientKey = tossClientKey();
  if (!clientKey) redirect("/billing/fail?code=BILLING_CLIENT_KEY_MISSING");
  if (!clientKey.startsWith("test_")) redirect("/billing/fail?code=BILLING_KEYS_NOT_TEST");

  if (!isProductId(checkout.product_id)) redirect("/billing");
  const product = getProductConfig(checkout.product_id);
  const order = await getProductOrderByCheckoutSession(checkout.id, user.id).catch(() => null);
  if (!order) redirect("/billing");
  const successUrl = new URL("/api/billing/toss/success", clientEnv.NEXT_PUBLIC_SITE_URL);
  successUrl.searchParams.set("session", checkout.id);
  const failUrl = new URL("/api/billing/toss/fail", clientEnv.NEXT_PUBLIC_SITE_URL);
  failUrl.searchParams.set("session", checkout.id);

  return (
    <div className="mx-auto max-w-lg space-y-5 py-10 sm:py-16">
      <div>
        <h1 className="text-2xl font-extrabold tracking-[-0.04em]">{product.name} 구매하기</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">일회성 결제 후 {order.credit_amount}회 이용권이 바로 지급돼요.</p>
      </div>
      <FormMessage variant="info">테스트 결제 환경이에요. 실제 카드 청구는 없어요.</FormMessage>
      <div className="rounded-2xl border bg-card px-5 py-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="font-bold">{product.name}</p>
          <p className="tabular text-xl font-extrabold">{order.price_krw.toLocaleString()}원</p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{order.credit_amount}회 · 결제일부터 {order.validity_days}일 동안 사용</p>
      </div>
      <TossCheckoutButton
        clientKey={clientKey}
        customerKey={checkout.customer_key}
        successUrl={successUrl.toString()}
        failUrl={failUrl.toString()}
        customerEmail={user.email}
        amount={order.price_krw}
        orderId={checkout.order_id}
        orderName={product.name}
      />
      <p className="text-center text-[13px] leading-6 text-muted-foreground">
        버튼을 누르면 토스페이먼츠 테스트 결제창으로 이동해요. 실제 금액은 청구되지 않아요.
      </p>
    </div>
  );
}
