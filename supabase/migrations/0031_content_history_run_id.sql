-- Lets a content_history row link back to the automation_runs row that
-- produced it. content_history only ever stored a plain-text summary
-- (title/topic/content/external_url) — the full generation result (e.g.
-- blog's hook/seoKeywords/imageSuggestion, added alongside the
-- generation-only switch) lives in automation_runs.output, which this
-- column is what finally makes joinable from the content list
-- (src/app/(app)/blog/page.tsx).
--
-- Nullable and not backfilled: every row inserted before this migration
-- just has run_id = null, and the UI treats that as "no full detail
-- available for this item" rather than an error.
alter table public.content_history
  add column run_id uuid references public.automation_runs (id) on delete set null;

create index content_history_run_id_idx on public.content_history (run_id) where run_id is not null;
