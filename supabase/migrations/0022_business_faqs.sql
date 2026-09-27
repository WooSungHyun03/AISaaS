-- Business-scoped Customer Support FAQ (Dev3 ticket #8). Deliberately a
-- separate table from `faqs` (the site-wide Guides/product FAQ from
-- 0013_faqs.sql) — different owner concept, different RLS shape, and
-- keeping them apart means listPublishedFaqs() (the existing public Guides
-- reader) never risks leaking a business's own FAQ into that public list.
--
-- No public/anonymous select policy here on purpose: an unauthenticated
-- customer-support chat request (#9/#10) will read this table through the
-- service-role client (see src/lib/supabase/admin.ts), not RLS — see
-- docs/dev3/IMPLEMENTATION_GUIDE.md #8 report for the options considered.
create table public.business_faqs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  question text not null,
  answer text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index business_faqs_business_id_idx on public.business_faqs (business_id);

create trigger set_business_faqs_updated_at
  before update on public.business_faqs
  for each row execute function public.set_updated_at();

alter table public.business_faqs enable row level security;

-- Every policy re-checks ownership via the same businesses.owner_id
-- subquery (content_history_select_own's pattern, 0012_row_level_security.sql)
-- rather than trusting a business_id passed in from the client. `with
-- check` on insert/update additionally blocks re-pointing a row at (or
-- creating one for) a business_id the caller doesn't own.
create policy "business_faqs_select_own" on public.business_faqs
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = business_faqs.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "business_faqs_insert_own" on public.business_faqs
  for insert with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_faqs.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "business_faqs_update_own" on public.business_faqs
  for update using (
    exists (
      select 1 from public.businesses b
      where b.id = business_faqs.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = business_faqs.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "business_faqs_delete_own" on public.business_faqs
  for delete using (
    exists (
      select 1 from public.businesses b
      where b.id = business_faqs.business_id
        and b.owner_id = auth.uid()
    )
  );
