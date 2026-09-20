"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBillingProvider } from "@/server/billing";
import { clientEnv } from "@/lib/env/client";

export async function startCheckout(plan: "STARTER" | "PRO"): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const provider = getBillingProvider();
  const { url } = await provider.createCheckout({
    userId: user.id,
    plan,
    successUrl: clientEnv.NEXT_PUBLIC_SITE_URL,
    cancelUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/billing`,
  });

  redirect(url);
}

export async function openBillingPortal(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const provider = getBillingProvider();
  const { url } = await provider.createPortal({
    userId: user.id,
    returnUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/billing`,
  });

  redirect(url);
}

export async function cancelSubscriptionAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const provider = getBillingProvider();
  await provider.cancelSubscription({ userId: user.id });
  redirect("/billing");
}
