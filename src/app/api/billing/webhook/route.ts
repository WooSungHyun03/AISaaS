import { NextResponse } from "next/server";
import { getBillingProvider } from "@/server/billing";
import { logger } from "@/lib/logger";

/**
 * Provider-agnostic webhook receiver. The mock provider's "checkout"
 * confirmation page (src/app/(app)/billing/mock-checkout) posts here
 * directly; a real provider would call this same URL from its own servers.
 * Signature verification (if the real provider requires it) belongs inside
 * that provider's handleWebhook(), using the raw `payload` + `headers`.
 */
export async function POST(request: Request) {
  const payload = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  try {
    await getBillingProvider().handleWebhook({ payload, headers });
    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook processing failed";
    logger.error("billing_webhook_failed", { message });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
