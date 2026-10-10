-- Ticket 1-6 (스냅샷 수집 파이프라인): same "new migration, don't edit 0036"
-- rule as 0037 — marketing_metric_snapshots already shipped in ticket 1-1.

-- `recorded_date` is explicitly KST (UTC+9), computed by Postgres itself —
-- not by application code — so a collection running near midnight can
-- never land on the wrong day because of a timezone mistake in the app.
-- `generated ... stored` backfills every existing row automatically.
--
-- Can't write this as `(recorded_at + interval '9 hours')::date` — casting
-- timestamptz -> date goes through the session's TimeZone setting, which
-- Postgres treats as STABLE, not IMMUTABLE, and generated columns require
-- an immutable expression (confirmed locally: that form fails with
-- "generation expression is not immutable", SQLSTATE 42P17). Instead this
-- computes whole days since the Unix epoch via `extract(epoch from
-- <interval>)` — interval epoch extraction has no timezone dependency at
-- all, so it IS immutable — then adds that many days to 1970-01-01, which
-- is pure calendar arithmetic on `date` (also immutable, no time/zone
-- component). Verified locally as a real generated column before use here.
alter table public.marketing_metric_snapshots
  add column recorded_date date generated always as (
    (date '1970-01-01' + floor(extract(epoch from (recorded_at - timestamptz 'epoch')) / 86400 + 9.0 / 24)::integer)
  ) stored not null;

-- Re-collecting the same (channel, metric) on the same KST day must
-- refresh the existing row, not fail or create a duplicate — see the
-- `on conflict ... do update` in src/server/channels/snapshot.ts. "같은
-- 날 두 번 수집해도 스냅샷 1건" depends on this exact constraint shape.
alter table public.marketing_metric_snapshots
  add constraint marketing_metric_snapshots_channel_metric_date_key
  unique (channel_id, metric, recorded_date);

-- Widens the source check to also allow 'DEMO_SEED' — written only by
-- scripts/seed-growth-demo.sql via a direct SQL insert, a local-only path
-- that never goes through application code. The app-facing zod enum
-- (src/server/channels/snapshot-source.ts's channelSnapshotSourceSchema)
-- deliberately does NOT include 'DEMO_SEED', so no app code path can
-- produce this value even by mistake — see
-- MARKETING_METRIC_SNAPSHOTS_DB_SOURCES and snapshot-source.test.ts, which
-- asserts this exact DB-vs-app-enum gap is intentional (unlike every
-- other enum in this domain, where the two must match exactly).
alter table public.marketing_metric_snapshots drop constraint marketing_metric_snapshots_source_check;
alter table public.marketing_metric_snapshots
  add constraint marketing_metric_snapshots_source_check check (source in ('live', 'mock', 'DEMO_SEED'));
