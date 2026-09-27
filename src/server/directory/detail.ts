import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { DirectoryTool } from "@/types/domain";
import { DirectoryError } from "./errors";

/**
 * Fetches one directory tool by slug for the detail page. Returns the row
 * regardless of `status` — an INACTIVE tool is still a real answer ("this
 * existed, it's just no longer maintained"), not the same as "no such
 * slug." Only a genuinely missing slug throws NOT_FOUND; the caller (Dev2's
 * page) decides what an INACTIVE status looks like in the UI.
 */
export async function getDirectoryToolBySlug(supabase: SupabaseClient<Database>, slug: string): Promise<DirectoryTool> {
  const { data, error } = await supabase.from("directory_tools").select("*").eq("slug", slug).maybeSingle();

  if (error) {
    throw new DirectoryError("UNKNOWN", `Directory detail query failed for slug "${slug}": ${error.message}`, {
      cause: error,
    });
  }
  if (!data) {
    throw new DirectoryError("NOT_FOUND", `No directory tool found for slug "${slug}".`);
  }

  return data;
}

/**
 * Marks a tool INACTIVE. Called only by the Sync Job when fetchRepoStats
 * fails with NOT_FOUND (repo renamed, deleted, or made private) — never for
 * RATE_LIMITED/NETWORK_FAILURE/AUTH_FAILED/UNKNOWN, which are transient or
 * config problems, not proof the repo itself is gone. Leaves every other
 * field (stars, description, ...) as last-known-good — this only flips
 * status, it never deletes the row.
 */
export async function markDirectoryToolInactive(admin: SupabaseClient<Database>, slug: string): Promise<void> {
  const { error } = await admin.from("directory_tools").update({ status: "INACTIVE" }).eq("slug", slug);
  if (error) {
    throw new DirectoryError("UNKNOWN", `Failed to mark "${slug}" INACTIVE: ${error.message}`, { cause: error });
  }
}
