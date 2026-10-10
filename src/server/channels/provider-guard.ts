import "server-only";
import { serverEnv } from "@/lib/env/server";

/**
 * CHANNEL_DATA_PROVIDER=mock fabricates channel diagnosis/growth numbers —
 * see scoring.ts/diagnosis.ts's "never show a fabricated number" rule. On a
 * real deployment this must never be reachable.
 *
 * Mirrors assertMockBillingAllowed's injectable-params shape (for a unit
 * test, not real use) — src/instrumentation.ts is the actual caller, at
 * server boot, because unlike the mock billing provider this one has no
 * request-time call site yet to attach a lazy check to.
 */
export function assertChannelDataProviderAllowed(
  provider: string = serverEnv.CHANNEL_DATA_PROVIDER,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (nodeEnv === "production" && provider === "mock") {
    throw new Error("CHANNEL_DATA_PROVIDER=mock은 운영 환경에서 사용할 수 없습니다. CHANNEL_DATA_PROVIDER=live 로 설정해주세요.");
  }
}
