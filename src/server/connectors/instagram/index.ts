import "server-only";
import { serverEnv } from "@/lib/env/server";
import type { PlatformConnector, PublishContentParams, PublishResult } from "../types";

/**
 * Placeholder — Meta Graph API integration for Instagram automation.
 * Interface only for now; implement publish() when Instagram automation
 * moves from "Coming Soon" to "Beta" in the marketplace.
 */
export class InstagramConnector implements PlatformConnector {
  readonly name = "instagram";

  isConfigured(): boolean {
    return Boolean(serverEnv.META_ACCESS_TOKEN && serverEnv.META_IG_USER_ID);
  }

  async publish(_params: PublishContentParams): Promise<PublishResult> {
    throw new Error("Instagram connector is not implemented yet.");
  }
}
