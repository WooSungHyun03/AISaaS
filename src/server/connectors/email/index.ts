import "server-only";
import { serverEnv } from "@/lib/env/server";
import type { PlatformConnector, PublishContentParams, PublishResult } from "../types";

/**
 * Placeholder — Resend integration for newsletter automation.
 * Interface only for now; implement publish() (send) when newsletter
 * automation moves from "Coming Soon" to "Beta" in the marketplace.
 */
export class EmailConnector implements PlatformConnector {
  readonly name = "email";

  isConfigured(): boolean {
    return Boolean(serverEnv.RESEND_API_KEY && serverEnv.RESEND_FROM_EMAIL);
  }

  async publish(_params: PublishContentParams): Promise<PublishResult> {
    throw new Error("Email connector is not implemented yet.");
  }
}
