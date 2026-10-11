-- Customer inquiries: a signed-in user writes to the service team and follows the answer.
--
-- Users can create and read their own inquiries and the answers to them, nothing else. Answers and status changes are
-- written by the service team with the service-role key after the app has checked that the caller is an admin
-- (ADMIN_EMAILS), so no row-level policy ever grants write access to a customer for them.
create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('PAYMENT', 'REFUND', 'BUG', 'FEATURE', 'OTHER')),
  subject text not null check (char_length(btrim(subject)) between 2 and 120),
  body text not null check (char_length(btrim(body)) between 10 and 4000),
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'IN_REVIEW', 'ANSWERED', 'CLOSED')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index inquiries_user_created_idx on public.inquiries (user_id, created_at desc);
create index inquiries_status_created_idx on public.inquiries (status, created_at desc);

create trigger set_inquiries_updated_at
  before update on public.inquiries
  for each row execute function public.set_updated_at();

-- The history of one inquiry: each answer, and each status change (who, from what, to what, when).
create table public.inquiry_messages (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries (id) on delete cascade,
  kind text not null check (kind in ('REPLY', 'STATUS_CHANGE')),
  body text check (body is null or char_length(btrim(body)) between 1 and 4000),
  from_status text check (from_status is null or from_status in ('RECEIVED', 'IN_REVIEW', 'ANSWERED', 'CLOSED')),
  to_status text check (to_status is null or to_status in ('RECEIVED', 'IN_REVIEW', 'ANSWERED', 'CLOSED')),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  check ((kind = 'REPLY' and body is not null) or (kind = 'STATUS_CHANGE' and to_status is not null))
);

create index inquiry_messages_inquiry_idx on public.inquiry_messages (inquiry_id, created_at);

alter table public.inquiries enable row level security;
alter table public.inquiry_messages enable row level security;

create policy "inquiries_select_own" on public.inquiries
  for select using (auth.uid() = user_id);

-- A new inquiry is always RECEIVED, and at most 5 per hour per user (this holds for direct API calls, not just the form).
create policy "inquiries_insert_own" on public.inquiries
  for insert with check (
    auth.uid() = user_id
    and status = 'RECEIVED'
    and (
      select count(*) from public.inquiries recent
      where recent.user_id = auth.uid() and recent.created_at > timezone('utc', now()) - interval '1 hour'
    ) < 5
  );

create policy "inquiry_messages_select_own" on public.inquiry_messages
  for select using (
    exists (select 1 from public.inquiries i where i.id = inquiry_messages.inquiry_id and i.user_id = auth.uid())
  );

grant select, insert on public.inquiries to authenticated;
grant select on public.inquiry_messages to authenticated;
revoke update, delete on public.inquiries from authenticated, anon;
revoke insert, update, delete on public.inquiry_messages from authenticated, anon;
