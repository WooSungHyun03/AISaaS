import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { disconnectConnection } from "@/server/connectors/integrations";
import { REFERENCE_BUCKET, VIDEO_BUCKET } from "@/server/shorts/assets";
import { logger } from "@/lib/logger";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Storage folders nest as `{userId}/{automationId}/[assets/ | {runId}/]file`; this bounds the walk. */
const MAX_FOLDER_DEPTH = 4;
const LIST_PAGE_SIZE = 1000;

/** Every object path under `prefix` (Supabase Storage `list` is one level at a time; folders come back with `id: null`). */
async function listObjectPaths(admin: AdminClient, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: LIST_PAGE_SIZE });
  if (error) {
    // The bucket is created lazily on the first upload; a user who never uploaded has nothing to delete.
    if (/not.?found/i.test(error.message)) return [];
    throw error;
  }
  const paths: string[] = [];
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id) paths.push(path);
    else if (depth < MAX_FOLDER_DEPTH) paths.push(...(await listObjectPaths(admin, bucket, path, depth + 1)));
  }
  return paths;
}

/**
 * Removes every uploaded Shorts file and finished video under `prefix` — `{userId}` for a deleted account,
 * `{userId}/{automationId}` for a deleted automation or business (the DB rows cascade, Storage does not). Best effort:
 * orphaned files are private and unreachable, so a failure is logged and never blocks the deletion that called it.
 */
export async function removeShortsFiles(admin: AdminClient, prefix: string): Promise<void> {
  for (const bucket of [REFERENCE_BUCKET, VIDEO_BUCKET]) {
    try {
      const paths = await listObjectPaths(admin, bucket, prefix);
      if (paths.length > 0) {
        const { error } = await admin.storage.from(bucket).remove(paths);
        if (error) throw error;
      }
    } catch (cause) {
      logger.warn("shorts_storage_cleanup_failed", { bucket, prefix, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
}

/**
 * Permanently deletes a user's account (privacy policy: deletion on
 * request). The caller must already have re-authenticated the user.
 *
 * Order matters: things that are NOT removed by the `auth.users` ->
 * `profiles` -> ... cascade go first — integration tokens live in Vault
 * (only `integration_secret_delete` removes them) and uploaded Shorts
 * files and finished videos live in Storage under `{userId}/`. Then deleting the
 * auth user cascades every row the user owns.
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: connections, error: connectionError } = await admin.from("integration_connections").select("id").eq("user_id", userId);
  if (connectionError) throw new Error("연결된 외부 서비스 정보를 확인하지 못했습니다.", { cause: connectionError });
  for (const connection of connections ?? []) {
    await disconnectConnection(admin, connection.id);
  }

  // Uploaded photos, clips and logos, and the videos made from them.
  await removeShortsFiles(admin, userId);

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error("계정을 삭제하지 못했습니다.", { cause: error });
}
