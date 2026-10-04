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
/** Webhook payloads are small JSON documents; refuse anything bigger before reading it into memory. */
const MAX_WEBHOOK_BYTES = 256 * 1024;

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const payload = await request.text();
  if (payload.length > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const headers = Object.fromEntries(request.headers.entries());

  try {
    await getBillingProvider().handleWebhook({ payload, headers });
    return NextResponse.json({ received: true });
  } catch (err) {
    logger.error("billing_webhook_failed", { message: err instanceof Error ? err.message : "Webhook processing failed" });
    // Never echo internal error text back to an unauthenticated caller.
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 400 });
  }
}
