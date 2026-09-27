-- Public Customer Support Chat API (Dev3 ticket #10).
--
-- `public_widget_id` is the ONLY identifier an anonymous website visitor
-- ever sends — never businesses.id. Using a volatile default
-- (gen_random_uuid()) means Postgres evaluates it once per existing row
-- during this ALTER TABLE (not a single shared value), so every existing
-- business gets its own random id, not a collision.
alter table public.businesses
  add column public_widget_id uuid not null default gen_random_uuid();

alter table public.businesses
  add constraint businesses_public_widget_id_key unique (public_widget_id);

-- Rate-limit counter for the widget chat endpoint. `requester_hash` is an
-- HMAC-SHA256 of the requester's IP (never the raw IP — see
-- src/server/customer-support/widget.ts#hashRequesterIp), keyed with a
-- server secret so it can't be reversed via a precomputed table of all
-- IPv4 addresses the way a plain unsalted hash could be.
create table public.support_widget_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  requester_hash text,
  requested_at timestamptz not null default timezone('utc', now())
);

-- Supports the widget-level count (business_id, requested_at range).
create index support_widget_requests_business_requested_idx
  on public.support_widget_requests (business_id, requested_at desc);

-- Supports the requester-level count (business_id + requester_hash,
-- requested_at range) — also used by the periodic best-effort cleanup in
-- checkAndRecordRateLimit to scan/delete rows older than its retention
-- window.
create index support_widget_requests_requester_idx
  on public.support_widget_requests (business_id, requester_hash, requested_at desc);

alter table public.support_widget_requests enable row level security;

-- No policies at all, on purpose: this table has nothing a person ever
-- needs to see or write directly (it's a pure rate-limit counter, not
-- product data like integration_connections' status), and its only caller
-- is an anonymous widget visitor who has no Supabase session to grant
-- access through in the first place. RLS enabled + zero policies means
-- every operation (including select) is denied to every role except
-- service-role, which bypasses RLS entirely — see
-- src/server/customer-support/widget.ts, the only code that ever touches
-- this table.
