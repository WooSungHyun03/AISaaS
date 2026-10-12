"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBillingProvider } from "@/server/billing";
import { clientEnv } from "@/lib/env/client";
import { isProductId, type ProductId } from "@/server/billing/products";
import { classifyCheckoutStartError } from "@/server/billing/checkout-errors";
import { logger } from "@/lib/logger";

export async function startProductOrder(productId: ProductId): Promise<void> {
  if (!isProductId(productId)) redirect("/billing/fail?code=INVALID_PRODUCT");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirectTo=${encodeURIComponent(`/billing?product=${productId}`)}`);

  let url: string;
  try {
    const provider = getBillingProvider();
    const checkout = await provider.createOrder({
      userId: user.id,
      productId,
      successUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/api/billing/toss/success`,
      cancelUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/billing/fail`,
    });
    url = checkout.url;
  } catch (error) {
    const failure = classifyCheckoutStartError(error);
    logger.error("checkout_start_failed", { userId: user.id, productId, failureCode: failure.code, detail: failure.detail });
    redirect(`/billing/fail?code=${failure.code}&product=${productId}`);
  }

  redirect(url);
}
