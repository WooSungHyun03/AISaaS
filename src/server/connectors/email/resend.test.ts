import { describe, expect, it } from "vitest";
import { isConnectorError } from "@/server/shared/errors";
import { ResendConnector } from "./resend";

/**
 * No RESEND_API_KEY/RESEND_FROM_EMAIL in this test environment (see
 * docs/CLAUDE_DAILY_PROGRESS.md "Blocked External") — the same pattern
 * WordPressConnector's "not configured" test relies on
 * (wordpress/index.test.ts), rather than mocking @/lib/env/server here.
 * The "configured" behavior (send success/retry/failure) is covered in
 * resend.send.test.ts, which mocks the module instead — kept in a
 * separate file so the two don't fight over serverEnv's module cache.
 */
describe("ResendConnector configuration", () => {
  it("isConfigured() is false and send() throws NOT_CONFIGURED without RESEND_API_KEY/RESEND_FROM_EMAIL", async () => {
    const connector = new ResendConnector();
    expect(connector.isConfigured()).toBe(false);

    const error = await connector
      .send({ to: { email: "subscriber@example.com" }, subject: "s", html: "<p>h</p>", idempotencyKey: "k" })
      .catch((e) => e);

    expect(isConnectorError(error)).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((error as any).code).toBe("NOT_CONFIGURED");
  });
});
