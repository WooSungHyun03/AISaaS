-- Ticket 1-6 (스냅샷 수집 파이프라인): tracked_channels (0034) didn't have
-- anywhere to count consecutive collection failures, so this is a new
-- migration rather than editing 0034 — existing migrations are treated as
-- already applied/final once shipped (see docs/person1/MIGRATION_NUMBERING_NOTES.md).
alter table public.tracked_channels
  add column consecutive_failure_count integer not null default 0;

-- Resets to 0 on a successful collection; the scheduler sets status to
-- the already-valid 'PAUSED' value (see 0034's status check constraint)
-- once this reaches 5, which drops the row out of tracked_channels_due_idx
-- (status = 'ACTIVE') automatically.
comment on column public.tracked_channels.consecutive_failure_count is
  'Consecutive metric-collection failures. Reset to 0 on success; the collector sets status=PAUSED at 5.';
