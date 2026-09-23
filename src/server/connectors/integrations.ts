import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database.types";
import type { ConnectionStatus, IntegrationConnection, IntegrationProvider, Json } from "@/types/domain";

type DbClient = SupabaseClient<Database>;

export interface CreateConnectionParams {
  userId: string;
  businessId: string;
  provider: IntegrationProvider;
  /** Non-secret label shown in the UI, e.g. a site URL or username. */
  accountIdentifier?: string | null;
  /**
   * Raw secret material (token / application password) to store in Vault.
   * Omit for a connection that genuinely has no secret. Never persisted
   * anywhere outside Vault — only its `secret_reference` id lands in
   * `integration_connections`.
   */
  secret?: string | null;
  metadata?: Record<string, Json | undefined>;
}

/**
 * Creates a connection, or reconnects an existing one for the same
 * (business, provider) pair — reconnecting updates the same row and rotates
 * the same Vault secret rather than leaving an orphaned one behind.
 */
export async function createConnection(
  params: CreateConnectionParams,
  admin: DbClient = createAdminClient(),
): Promise<IntegrationConnection> {
  const existing = await getConnection(admin, params.userId, params.businessId, params.provider);

  let secretReference = existing?.secret_reference ?? null;
  if (params.secret) {
    if (secretReference) {
      const { error } = await admin.rpc("integration_secret_update", {
        p_id: secretReference,
        p_secret: params.secret,
      });
      if (error) throw new Error(`Failed to update connection secret: ${error.message}`);
    } else {
      const { data, error } = await admin.rpc("integration_secret_create", {
        p_secret: params.secret,
        p_name: `${params.provider}:${params.businessId}`,
      });
      if (error) throw new Error(`Failed to store connection secret: ${error.message}`);
      secretReference = data;
    }
  }

  const { data: row, error } = await admin
    .from("integration_connections")
    .upsert(
      {
        user_id: params.userId,
        business_id: params.businessId,
        provider: params.provider,
        account_identifier: params.accountIdentifier ?? null,
        status: "CONNECTED",
        secret_reference: secretReference,
        metadata: params.metadata ?? {},
        connected_at: new Date().toISOString(),
      },
      { onConflict: "business_id,provider" },
    )
    .select()
    .single();

  if (error || !row) throw new Error(`Failed to save connection: ${error?.message}`);
  return row;
}

export async function getConnection(
  admin: DbClient,
  userId: string,
  businessId: string,
  provider: IntegrationProvider,
): Promise<IntegrationConnection | null> {
  const { data, error } = await admin
    .from("integration_connections")
    .select()
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) throw new Error(`Failed to look up connection: ${error.message}`);
  return data;
}

/**
 * Decrypts and returns the connection's stored secret via Vault. Returns
 * null for a connection that has no secret (e.g. never configured, or
 * already disconnected).
 */
export async function getConnectionSecret(
  admin: DbClient,
  connection: Pick<IntegrationConnection, "secret_reference">,
): Promise<string | null> {
  if (!connection.secret_reference) return null;

  const { data, error } = await admin.rpc("integration_secret_read", {
    p_id: connection.secret_reference,
  });
  if (error) throw new Error(`Failed to read connection secret: ${error.message}`);
  return data;
}

export async function updateConnectionStatus(
  admin: DbClient,
  connectionId: string,
  status: ConnectionStatus,
  metadata?: Record<string, Json | undefined>,
): Promise<void> {
  const update: Database["public"]["Tables"]["integration_connections"]["Update"] = { status };
  if (metadata) update.metadata = metadata;

  const { error } = await admin.from("integration_connections").update(update).eq("id", connectionId);
  if (error) throw new Error(`Failed to update connection status: ${error.message}`);
}

/**
 * Deletes the paired Vault secret (if any) and marks the connection
 * DISCONNECTED rather than deleting the row, so connection history
 * (`connected_at`, `account_identifier`) survives a disconnect/reconnect.
 */
export async function disconnectConnection(admin: DbClient, connectionId: string): Promise<void> {
  const { data: connection, error: fetchError } = await admin
    .from("integration_connections")
    .select("secret_reference")
    .eq("id", connectionId)
    .maybeSingle();
  if (fetchError) throw new Error(`Failed to look up connection: ${fetchError.message}`);
  if (!connection) return;

  if (connection.secret_reference) {
    const { error: deleteSecretError } = await admin.rpc("integration_secret_delete", {
      p_id: connection.secret_reference,
    });
    if (deleteSecretError) throw new Error(`Failed to delete connection secret: ${deleteSecretError.message}`);
  }

  const { error } = await admin
    .from("integration_connections")
    .update({ status: "DISCONNECTED", secret_reference: null })
    .eq("id", connectionId);
  if (error) throw new Error(`Failed to disconnect connection: ${error.message}`);
}
