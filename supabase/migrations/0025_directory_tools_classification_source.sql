-- Tracks how directory_tools.category was decided (Dev3 ticket #4).
--
-- Values/casing are defined once in src/server/directory/classification-source.ts.
-- Any FUTURE migration that changes the allowed values must drop and re-add
-- a constraint named `directory_tools_classification_source_check` (same
-- name) — classification-source.test.ts finds the highest-numbered
-- migration mentioning that name and asserts it matches
-- CLASSIFICATION_SOURCES.
--
-- Nullable, no default: existing rows (seed.sql's hand-picked categories)
-- get NULL, meaning "not classified through this pipeline" — distinct from
-- 'ai'/'keyword', which only ever come from classifyDirectoryTool().
alter table public.directory_tools
  add column classification_source text;

alter table public.directory_tools
  add constraint directory_tools_classification_source_check
  check (classification_source is null or classification_source in ('ai', 'keyword'));
