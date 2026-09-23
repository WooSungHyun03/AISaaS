import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createConnection, getConnection, getConnectionSecret } from "@/server/connectors/integrations";
import type { Database } from "@/types/database.types";
import type { IntegrationConnection } from "@/types/domain";
import { WordPressConnector, normalizeWordPressSiteUrl } from "./index";

type DbClient = SupabaseClient<Database>;

export interface VerifyAndConnectWordPressParams {
  userId: string;
  businessId: string;
  siteUrl: string;
  username: string;
  appPassword: string;
}

/**
 * Verifies WordPress REST API credentials with a live authenticated request,
 * then persists a CONNECTED row (Vault-backed secret, Day 2's
 * `createConnection()`) — only after verification succeeds, never before.
 * A failed verification throws `ConnectorError` and writes nothing.
 */
export async function verifyAndConnectWordPress(
  params: VerifyAndConnectWordPressParams,
  admin: DbClient = createAdminClient(),
): Promise<IntegrationConnection> {
  const siteUrl = normalizeWordPressSiteUrl(params.siteUrl);
  await new WordPressConnector({ siteUrl, username: params.username, appPassword: params.appPassword }).testConnection();

  return createConnection(
    {
      userId: params.userId,
      businessId: params.businessId,
      provider: "wordpress",
      accountIdentifier: siteUrl,
      secret: params.appPassword,
      metadata: { username: params.username },
    },
    admin,
  );
}

/**
 * Builds a `WordPressConnector` from a business's stored
 * `integration_connections` row, decrypting the Application Password through
 * Vault. Returns null when the business has no CONNECTED WordPress
 * connection — callers decide whether that's an error or a fallback case
 * (e.g. the legacy per-automation credential path in `blog.ts`).
 */
export async function loadWordPressConnector(
  admin: DbClient,
  userId: string,
  businessId: string,
): Promise<WordPressConnector | null> {
  const connection = await getConnection(admin, userId, businessId, "wordpress");
  if (!connection || connection.status !== "CONNECTED" || !connection.account_identifier) return null;

  const appPassword = await getConnectionSecret(admin, connection);
  if (!appPassword) return null;

  const metadata = (connection.metadata ?? {}) as { username?: string };
  if (!metadata.username) return null;

  return new WordPressConnector({
    siteUrl: connection.account_identifier,
    username: metadata.username,
    appPassword,
  });
}
