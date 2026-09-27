-- Adds a status column to directory_tools so the Sync Job (#2) can mark a
-- repo INACTIVE when GitHub reports it gone (renamed, deleted, or made
-- private — GitHub returns 404 for all three, deliberately not
-- distinguishing which) instead of either silently showing stale data as
-- current, or deleting the row and losing its history.
--
-- `not null default 'ACTIVE'` backfills every existing row to ACTIVE.
--
-- Values/casing are defined once in src/server/directory/status.ts and
-- match this project's existing status-column convention
-- (automations.status, setup_requests.status: uppercase). Any FUTURE
-- migration that changes the allowed values must drop and re-add a
-- constraint named `directory_tools_status_check` (same name) —
-- status.test.ts finds the highest-numbered migration mentioning that name
-- and asserts it matches DIRECTORY_TOOL_STATUSES.
alter table public.directory_tools
  add column status text not null default 'ACTIVE';

alter table public.directory_tools
  add constraint directory_tools_status_check
  check (status in ('ACTIVE', 'INACTIVE'));
