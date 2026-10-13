import "server-only";
import { clientEnv } from "@/lib/env/client";
import { serverEnv } from "@/lib/env/server";

/** Why Toss checkout cannot start. Each one names exactly one thing to fix. */
export type TossKeyProblem = "CLIENT_KEY_MISSING" | "SECRET_KEY_MISSING" | "KEYS_NOT_TEST";

export class TossConfigError extends Error {
  readonly problem: TossKeyProblem;
  constructor(problem: TossKeyProblem) {
    super(
      problem === "CLIENT_KEY_MISSING"
        ? "Missing required environment variable: NEXT_PUBLIC_TOSS_CLIENT_KEY (or TOSS_CLIENT_KEY)."
        : problem === "SECRET_KEY_MISSING"
          ? "Missing required environment variable: TOSS_SECRET_KEY."
          : "Toss billing currently accepts test keys only. Configure test client and secret keys.",
    );
    this.name = "TossConfigError";
    this.problem = problem;
  }
}

/**
 * The Toss client key. `NEXT_PUBLIC_TOSS_CLIENT_KEY` is the documented name; `TOSS_CLIENT_KEY` is accepted too because
 * the key is public anyway and a deployment that stored it without the prefix would otherwise fail on every checkout.
 */
export function tossClientKey(): string | undefined {
  return clientEnv.NEXT_PUBLIC_TOSS_CLIENT_KEY || serverEnv.TOSS_CLIENT_KEY || undefined;
}

/**
 * The key pair for a checkout. Only test keys are accepted: a live key is refused, never used. Throws a
 * TossConfigError that says which key is missing or wrong, so support can point at the real cause.
 */
export function resolveTossTestKeys(): { clientKey: string; secretKey: string } {
  const clientKey = tossClientKey();
  const secretKey = serverEnv.TOSS_SECRET_KEY;
  if (!clientKey) throw new TossConfigError("CLIENT_KEY_MISSING");
  if (!secretKey) throw new TossConfigError("SECRET_KEY_MISSING");
  if (!clientKey.startsWith("test_") || !secretKey.startsWith("test_")) throw new TossConfigError("KEYS_NOT_TEST");
  return { clientKey, secretKey };
}
