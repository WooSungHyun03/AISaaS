import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database.types";
import type { DirectoryTool } from "@/types/domain";
import { directoryCategorySchema } from "./taxonomy";
import { DirectoryError } from "./errors";

export const DIRECTORY_SORT_OPTIONS = ["stars", "updated_at"] as const;
export type DirectorySortOption = (typeof DIRECTORY_SORT_OPTIONS)[number];

const MAX_PAGE_SIZE = 50;

/**
 * Accepts one tag or several (Next.js `searchParams` gives a plain string
 * for a single `?tags=x`, an array once there's more than one `?tags=x&tags=y`).
 */
const tagsSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .pipe(z.array(z.string().trim().min(1).max(50)).max(10));

/**
 * Every field uses `.catch()`, not `.default()` — `.default()` only kicks in
 * when a field is *missing*; `.catch()` also rescues a field that's
 * *present but invalid* (e.g. `?sort=drop_table`), which is what a public
 * search endpoint needs: a bad filter should be silently ignored, never a
 * 500.
 */
export const directorySearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional().catch(undefined),
  // Real callers (Next.js `searchParams`) hand us an untyped string — pipe
  // through a plain string first so the *input* type stays `string`, then
  // validate against the narrow enum. Piping straight into
  // directoryCategorySchema/z.enum(...) would make TypeScript require an
  // already-known-valid literal at the call site, which defeats the point
  // of validating untrusted input at runtime.
  category: z.string().pipe(directoryCategorySchema).optional().catch(undefined),
  language: z.string().trim().min(1).max(50).optional().catch(undefined),
  tags: tagsSchema.optional().catch(undefined),
  sort: z.string().pipe(z.enum(DIRECTORY_SORT_OPTIONS)).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional().catch(undefined),
});

export type DirectorySearchQueryInput = z.input<typeof directorySearchQuerySchema>;
export type DirectorySearchQuery = z.output<typeof directorySearchQuerySchema>;

export interface DirectorySearchResult {
  tools: DirectoryTool[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Escapes ILIKE's own wildcard characters (`%`, `_`) plus the escape
 * character itself, so a literal "%" or "_" typed by a user is matched as
 * text, not treated as a pattern wildcard.
 */
function escapeIlikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`);
}

/**
 * Searches/filters/sorts/paginates the public directory_tools catalog.
 * Takes an RLS-scoped client (`createClient()`) — directory_tools has a
 * public "select using (true)" policy, so no service-role client is needed
 * for reads.
 */
export async function searchDirectoryTools(
  supabase: SupabaseClient<Database>,
  rawQuery: DirectorySearchQueryInput,
): Promise<DirectorySearchResult> {
  const parsed = directorySearchQuerySchema.parse(rawQuery);
  const { q, category, language, tags } = parsed;
  // `.catch(undefined)` (not `.catch(default)`) keeps these optional at the
  // type level too (z.input requires no keys) — the actual defaults are
  // applied here instead.
  const sort = parsed.sort ?? "stars";
  const page = parsed.page ?? 1;
  const pageSize = parsed.pageSize ?? 20;

  // Public search only ever shows ACTIVE tools — a repo the Sync Job (#2)
  // found gone (renamed/deleted/private) shouldn't surface in results even
  // though the row is kept (not deleted) for history. There's no override
  // param: nothing in this codebase yet needs to search INACTIVE tools.
  let query = supabase.from("directory_tools").select("*", { count: "exact" }).eq("status", "ACTIVE");

  if (q) query = query.ilike("name", `%${escapeIlikePattern(q)}%`);
  if (category) query = query.eq("category", category);
  if (language) query = query.eq("language", language);
  if (tags && tags.length > 0) query = query.overlaps("tags", tags);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await query
    .order(sort, { ascending: false, nullsFirst: false })
    .range(from, to);

  if (error) {
    throw new DirectoryError("UNKNOWN", `Directory search query failed: ${error.message}`, { cause: error });
  }

  return { tools: data ?? [], total: count ?? 0, page, pageSize };
}
