import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createConnection, getConnection, getConnectionSecret, updateConnectionStatus } from "@/server/connectors/integrations";
import type { Database } from "@/types/database.types";
import { buildInstagramAuthorizationUrl, exchangeInstagramCode, getInstagramProfile, isProfessionalInstagramAccount } from "./oauth";
import { InstagramConnector } from "./index";

type DbClient = SupabaseClient<Database>;

export interface InstagramOAuthCookie {
  state: string;
  businessId: string;
}

/**
 * Starts a new Instagram OAuth attempt: a fresh CSRF `state` token plus the
 * Meta authorization URL to redirect to. `cookieValue` is what the caller
 * (the /connect route) stores in the short-lived, httpOnly OAuth cookie —
 * packed here so the cookie's shape (state + the business it's for) is
 * defined once, next to the code that later parses it back.
 */
export function startInstagramOAuth(params: { appId: string; redirectUri: string; businessId: string }): { authorizationUrl: string; cookieValue: string } {
  const state = randomBytes(24).toString("base64url");
  const authorizationUrl = buildInstagramAuthorizationUrl({ appId: params.appId, redirectUri: params.redirectUri, state });
  const cookieValue = Buffer.from(JSON.stringify({ state, businessId: params.businessId } satisfies InstagramOAuthCookie)).toString("base64url");
  return { authorizationUrl, cookieValue };
}

export function parseInstagramOAuthCookie(value: string | undefined): InstagramOAuthCookie | null {
  try {
    const parsed = JSON.parse(Buffer.from(value ?? "", "base64url").toString("utf8")) as Partial<InstagramOAuthCookie>;
    return parsed.state && parsed.businessId ? { state: parsed.state, businessId: parsed.businessId } : null;
  } catch {
    return null;
  }
}

/** Constant-time state comparison — a naive `===` would leak timing information a CSRF attacker could exploit. */
export function isMatchingOAuthState(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type InstagramOAuthOutcome = "connected" | "professional_required" | "error";

/**
 * Exchanges the authorization code, confirms the account is a Professional
 * (Business/Creator) account — rejecting a personal account instead of
 * silently connecting it — and persists a CONNECTED row via Day 2's
 * `createConnection()` (Vault-backed; the access token never lands in a
 * plaintext column). Any failure (code exchange, profile fetch, a personal
 * account) leaves a pre-existing connection for this business marked ERROR
 * rather than silently still showing CONNECTED with a now-invalid attempt.
 */
export async function completeInstagramOAuth(
  params: { userId: string; businessId: string; appId: string; appSecret: string; redirectUri: string; code: string },
  admin: DbClient = createAdminClient(),
): Promise<InstagramOAuthOutcome> {
  try {
    const token = await exchangeInstagramCode({ appId: params.appId, appSecret: params.appSecret, redirectUri: params.redirectUri, code: params.code });
    const profile = await getInstagramProfile(token.accessToken);
    if (!isProfessionalInstagramAccount(profile.accountType)) return "professional_required";

    const metadata: Record<string, string> = { accountId: profile.id, accountType: profile.accountType };
    if (token.expiresIn) metadata.expiresAt = new Date(Date.now() + token.expiresIn * 1000).toISOString();
    await createConnection(
      {
        userId: params.userId,
        businessId: params.businessId,
        provider: "instagram",
        accountIdentifier: `@${profile.username}`,
        secret: token.accessToken,
        metadata,
      },
      admin,
    );
    return "connected";
  } catch {
    await markInstagramConnectionError(admin, params.userId, params.businessId);
    return "error";
  }
}

/**
 * Builds an `InstagramConnector` from a business's stored
 * `integration_connections` row, decrypting the access token through Vault
 * — mirrors `wordpress/connect.ts#loadWordPressConnector()` exactly. Returns
 * null for any business without a usable CONNECTED Instagram connection;
 * callers (Day 9's `instagramAutomationHandler`) decide whether that's a
 * hard failure or a fallback to the legacy env-configured connector.
 */
export async function loadInstagramConnector(
  admin: DbClient,
  userId: string,
  businessId: string,
): Promise<InstagramConnector | null> {
  const connection = await getConnection(admin, userId, businessId, "instagram");
  if (!connection || connection.status !== "CONNECTED") return null;

  const accessToken = await getConnectionSecret(admin, connection);
  if (!accessToken) return null;

  const metadata = (connection.metadata ?? {}) as { accountId?: string };
  if (!metadata.accountId) return null;

  return new InstagramConnector({ accessToken, igUserId: metadata.accountId });
}

async function markInstagramConnectionError(admin: DbClient, userId: string, businessId: string): Promise<void> {
  try {
    const connection = await getConnection(admin, userId, businessId, "instagram");
    if (connection) await updateConnectionStatus(admin, connection.id, "ERROR");
  } catch {
    /* The redirect result code remains the source of truth for this attempt. */
  }
}
