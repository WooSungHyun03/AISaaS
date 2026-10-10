/**
 * Runs once when a new Next.js server instance boots (not during `next
 * build`'s page-data collection, which also sets NODE_ENV=production — see
 * src/lib/env/server.ts's comment on SUPPORT_WIDGET_IP_HASH_SECRET for why
 * that distinction matters here; verified empirically that `next build`
 * does not invoke this, and `next start` does).
 *
 * CHANNEL_DATA_PROVIDER=mock fabricates channel diagnosis/growth numbers.
 * Ticket 1-1 has no code path that calls the provider yet, so a lazy
 * call-site guard (like assertMockBillingAllowed's) would never actually
 * run — this fails the boot instead, so a production deploy misconfigured
 * with the mock provider can't silently go live.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertChannelDataProviderAllowed } = await import("@/server/channels/provider-guard");
  assertChannelDataProviderAllowed();
}
