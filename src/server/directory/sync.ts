import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";
import { CURATED_REPOS, type CuratedRepo } from "./curated-repos";
import { fetchRepoStats, shouldStopForRateLimit, type GithubRepoStats } from "./github";
import { isDirectoryError, type DirectoryErrorCode } from "./errors";
import { markDirectoryToolInactive } from "./detail";

export interface DirectorySyncFailure {
  slug: string;
  code: DirectoryErrorCode;
  message: string;
}

export interface DirectorySyncResult {
  /** Repos an actual GitHub call was made for (success or failure) — excludes `skipped`. */
  processed: number;
  /** Repos successfully written to directory_tools (inserted or updated). */
  updated: number;
  failed: DirectorySyncFailure[];
  /** Slugs never attempted because the batch stopped early (rate limit). */
  skipped: string[];
  stoppedEarly: boolean;
  /** Set only when stoppedEarly is true — when it's safe to sync again. */
  retryAfter?: Date;
  finishedAt: Date;
}

type DirectoryToolsTable = Database["public"]["Tables"]["directory_tools"];

/**
 * Only ever reads `description` — the one field whose "fill if empty, never
 * overwrite" rule (see updateExistingRow) needs to know the current value.
 */
async function findExistingDescription(
  admin: SupabaseClient<Database>,
  slug: string,
): Promise<{ exists: boolean; description: string | null }> {
  const { data, error } = await admin.from("directory_tools").select("description").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return { exists: data !== null, description: data?.description ?? null };
}

/**
 * First time this curated repo is seen: insert a full row. `name` prefers
 * the curated list's hand-picked display name, falling back to GitHub's raw
 * repo name — GitHub's API has no separate "pretty name" field to fall back
 * to instead.
 */
async function insertNewRow(
  admin: SupabaseClient<Database>,
  curated: CuratedRepo,
  stats: GithubRepoStats,
): Promise<void> {
  const row: DirectoryToolsTable["Insert"] = {
    name: curated.name ?? curated.repo,
    slug: curated.slug,
    github_url: `https://github.com/${curated.owner}/${curated.repo}`,
    description: stats.description,
    stars: stats.stars,
    forks: stats.forks,
    language: stats.language,
    license: stats.license,
    status: "ACTIVE",
    last_github_sync_at: new Date().toISOString(),
  };

  const { error } = await admin.from("directory_tools").insert(row);
  if (error) throw error;
}

/**
 * Existing row: only ever touches the fields GitHub is the source of truth
 * for (stars/forks/language/license/sync timestamp/status). `name`/
 * `category`/`tags`/`github_url` are never written here — a human (seed
 * data today, #4's AI classification and #8-style manual edits later) owns
 * those. `description` is a partial exception: filled in only if it was
 * empty, never overwritten once a human (or a prior sync) has set it.
 *
 * `status` is always reset to ACTIVE here — reaching this function at all
 * means fetchRepoStats just succeeded, which is proof the repo is back, so
 * a previously-INACTIVE row is restored automatically (no manual fix-up
 * needed once GitHub is reachable again).
 */
async function updateExistingRow(
  admin: SupabaseClient<Database>,
  slug: string,
  stats: GithubRepoStats,
  existingDescription: string | null,
): Promise<void> {
  const row: DirectoryToolsTable["Update"] = {
    stars: stats.stars,
    forks: stats.forks,
    language: stats.language,
    license: stats.license,
    status: "ACTIVE",
    last_github_sync_at: new Date().toISOString(),
    ...(existingDescription === null ? { description: stats.description } : {}),
  };

  const { error } = await admin.from("directory_tools").update(row).eq("slug", slug);
  if (error) throw error;
}

/**
 * Syncs GitHub metadata for every curated repo into directory_tools.
 * Sequential by design (never Promise.all) — GitHub's rate limit is shared
 * across all requests, and a sequential loop is what lets shouldStopForRateLimit
 * check the remaining quota between calls instead of firing every request
 * before any of them can be checked.
 *
 * `curatedRepos`/`admin` are injectable (default to the real list / a real
 * service-role client) purely so tests can supply fakes — production
 * callers (the future Dev1-owned cron route) call this with no arguments.
 */
export async function syncDirectoryTools(
  curatedRepos: CuratedRepo[] = CURATED_REPOS,
  admin: SupabaseClient<Database> = createAdminClient(),
): Promise<DirectorySyncResult> {
  let processed = 0;
  let updated = 0;
  const failed: DirectorySyncFailure[] = [];
  const skipped: string[] = [];
  let stoppedEarly = false;
  let retryAfter: Date | undefined;

  for (let i = 0; i < curatedRepos.length; i++) {
    const curated = curatedRepos[i];

    let fetched: Awaited<ReturnType<typeof fetchRepoStats>>;
    try {
      fetched = await fetchRepoStats(curated.owner, curated.repo);
    } catch (err) {
      if (isDirectoryError(err) && err.code === "RATE_LIMITED") {
        stoppedEarly = true;
        retryAfter = err.retryAfter;
        skipped.push(...curatedRepos.slice(i).map((r) => r.slug));
        logger.warn("directory_sync_rate_limited", { slug: curated.slug, retryAfter: err.retryAfter?.toISOString() });
        break;
      }

      // Only NOT_FOUND deactivates a tool — GitHub returns 404 for
      // renamed/deleted/made-private repos alike (it deliberately doesn't
      // distinguish), so this is the one code that's actual proof the repo
      // itself is gone. AUTH_FAILED/NETWORK_FAILURE/UNKNOWN are transient or
      // config problems, not evidence of that — status is left untouched.
      if (isDirectoryError(err) && err.code === "NOT_FOUND") {
        try {
          await markDirectoryToolInactive(admin, curated.slug);
          logger.warn("directory_sync_marked_inactive", { slug: curated.slug });
        } catch (markErr) {
          logger.error("directory_sync_mark_inactive_failed", {
            slug: curated.slug,
            message: markErr instanceof Error ? markErr.message : String(markErr),
          });
        }
      }

      processed++;
      failed.push({
        slug: curated.slug,
        code: isDirectoryError(err) ? err.code : "UNKNOWN",
        message: err instanceof Error ? err.message : String(err),
      });
      logger.warn("directory_sync_fetch_failed", {
        slug: curated.slug,
        code: isDirectoryError(err) ? err.code : "UNKNOWN",
      });
      continue;
    }

    processed++;
    try {
      const existing = await findExistingDescription(admin, curated.slug);
      if (existing.exists) {
        await updateExistingRow(admin, curated.slug, fetched.stats, existing.description);
      } else {
        await insertNewRow(admin, curated, fetched.stats);
      }
      updated++;
    } catch (err) {
      failed.push({
        slug: curated.slug,
        code: "UNKNOWN",
        message: err instanceof Error ? err.message : String(err),
      });
      logger.error("directory_sync_write_failed", {
        slug: curated.slug,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (shouldStopForRateLimit(fetched.rateLimit)) {
      stoppedEarly = true;
      retryAfter = fetched.rateLimit.resetAt;
      skipped.push(...curatedRepos.slice(i + 1).map((r) => r.slug));
      logger.warn("directory_sync_stopping_low_quota", {
        remaining: fetched.rateLimit.remaining,
        resetAt: fetched.rateLimit.resetAt.toISOString(),
      });
      break;
    }
  }

  const result: DirectorySyncResult = {
    processed,
    updated,
    failed,
    skipped,
    stoppedEarly,
    retryAfter,
    finishedAt: new Date(),
  };

  logger.info("directory_sync_finished", {
    processed: result.processed,
    updated: result.updated,
    failed: result.failed.length,
    skipped: result.skipped.length,
    stoppedEarly: result.stoppedEarly,
  });

  return result;
}
