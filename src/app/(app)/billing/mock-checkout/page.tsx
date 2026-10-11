import { redirect } from "next/navigation";
import { FormMessage } from "@/components/ui/form-message";
import { MockCheckoutConfirm } from "@/components/billing/mock-checkout-confirm";
import { createClient } from "@/lib/supabase/server";
import { getCheckoutSession } from "@/server/billing/checkout-sessions";
import { getProductConfig, isProductId } from "@/server/billing/products";
import { getProductOrderByCheckoutSession } from "@/server/billing/orders";

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

  if (!isProductId(checkout.product_id)) redirect("/billing");
  const product = getProductConfig(checkout.product_id);
  const order = await getProductOrderByCheckoutSession(checkout.id, user.id).catch(() => null);
  if (!order) redirect("/billing");
  if (checkout.status === "SUCCEEDED") redirect(`/billing/success?session=${checkout.id}`);

  return (
    <div className="mx-auto max-w-md space-y-5 py-10 sm:py-16">
      <h1 className="text-2xl font-extrabold tracking-[-0.04em]">결제 시뮬레이션</h1>
      <FormMessage variant="info">모의 결제 모드예요. 실제로 결제되지 않아요.</FormMessage>
      <div className="rounded-2xl border bg-card px-5 py-4">
        <p className="font-bold">{product.name}</p>
        <p className="tabular text-sm text-muted-foreground">{order.price_krw.toLocaleString()}원 · {order.credit_amount}회 · 결제일부터 {order.validity_days}일</p>
      </div>
      <MockCheckoutConfirm sessionId={checkout.id} productName={product.name} />
    </div>
  );
}
