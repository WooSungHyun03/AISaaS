-- Search support for directory_tools (Dev3 ticket #5).
--
-- A plain btree index (the default) cannot be used by `ilike '%term%'`
-- because the leading `%` means Postgres can't binary-search into it — it
-- would still need a full table scan. `pg_trgm` breaks text into 3-letter
-- fragments ("trigrams") and a GIN index over those fragments *can* be used
-- for a leading-wildcard ILIKE, which is what makes the name search in
-- search.ts fast once this table has more than a handful of rows.
--
-- pg_trgm is a standard Postgres contrib extension and a commonly-enabled
-- one on Supabase (listed under Database -> Extensions in the dashboard) —
-- ⚠️ not independently re-verified against a live Supabase project in this
-- session; confirm it's enabled there before relying on this migration in
-- production.
create extension if not exists "pg_trgm";

create index directory_tools_name_trgm_idx
  on public.directory_tools using gin (name gin_trgm_ops);

-- Same idea for the `tags @> / && (overlaps)` filter: a GIN index over the
-- array lets Postgres look up matching rows by tag instead of scanning
-- every row's tags array.
create index directory_tools_tags_idx
  on public.directory_tools using gin (tags);
