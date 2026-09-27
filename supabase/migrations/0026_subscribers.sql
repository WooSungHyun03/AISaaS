-- Newsletter automation (Day 7): a business's own list of subscribers,
-- separate from `profiles`/`auth.users` — a subscriber is never a platform
-- user, just an email address + opt-in state the newsletter handler reads.
create table public.subscribers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  email text not null,
  name text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'UNSUBSCRIBED')),
  subscribed_at timestamptz not null default timezone('utc', now()),
  unsubscribed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  -- Re-subscribing the same address updates the existing row (see
  -- src/server/connectors/email/subscribers.ts) instead of accumulating
  -- duplicate rows for one business + email.
  unique (business_id, email)
);

create index subscribers_business_id_status_idx on public.subscribers (business_id, status);

create trigger set_subscribers_updated_at
  before update on public.subscribers
  for each row execute function public.set_updated_at();

alter table public.subscribers enable row level security;

-- Every policy re-checks ownership via the same businesses.owner_id
-- subquery used by business_faqs (0022_business_faqs.sql) rather than
-- trusting a business_id passed in from the client. `with check` on
-- insert/update additionally blocks re-pointing a row at (or creating one
-- for) a business_id the caller doesn't own. The newsletter handler itself
-- always reads through the service-role client (bypasses RLS entirely,
-- see src/lib/supabase/admin.ts) — these policies exist for a future
-- owner-facing subscriber management UI.
create policy "subscribers_select_own" on public.subscribers
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = subscribers.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "subscribers_insert_own" on public.subscribers
  for insert with check (
    exists (
      select 1 from public.businesses b
      where b.id = subscribers.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "subscribers_update_own" on public.subscribers
  for update using (
    exists (
      select 1 from public.businesses b
      where b.id = subscribers.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = subscribers.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "subscribers_delete_own" on public.subscribers
  for delete using (
    exists (
      select 1 from public.businesses b
      where b.id = subscribers.business_id
        and b.owner_id = auth.uid()
    )
  );
