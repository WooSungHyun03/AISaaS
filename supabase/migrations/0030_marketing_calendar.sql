-- Business-scoped marketing content plan. AI generation creates PLANNED
-- rows; automation execution can later connect a row to the automation and
-- content_history record that produced/published it.
create table public.calendar_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  planned_date date not null,
  platform text not null check (platform in ('blog', 'instagram_reels', 'youtube_shorts')),
  content_type text not null,
  topic text not null,
  goal text not null,
  summary text not null,
  cta text not null,
  status text not null default 'PLANNED' check (status in ('PLANNED', 'GENERATED', 'PUBLISHED', 'SKIPPED')),
  automation_id uuid references public.automations (id) on delete set null,
  content_history_id uuid references public.content_history (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index calendar_items_business_date_idx
  on public.calendar_items (business_id, planned_date);

create index calendar_items_automation_id_idx
  on public.calendar_items (automation_id)
  where automation_id is not null;

create index calendar_items_content_history_id_idx
  on public.calendar_items (content_history_id)
  where content_history_id is not null;

create trigger set_calendar_items_updated_at
  before update on public.calendar_items
  for each row execute function public.set_updated_at();

alter table public.calendar_items enable row level security;

create policy "calendar_items_select_own" on public.calendar_items
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = calendar_items.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "calendar_items_insert_own" on public.calendar_items
  for insert with check (
    exists (
      select 1 from public.businesses b
      where b.id = calendar_items.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "calendar_items_update_own" on public.calendar_items
  for update using (
    exists (
      select 1 from public.businesses b
      where b.id = calendar_items.business_id
        and b.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.businesses b
      where b.id = calendar_items.business_id
        and b.owner_id = auth.uid()
    )
  );

create policy "calendar_items_delete_own" on public.calendar_items
  for delete using (
    exists (
      select 1 from public.businesses b
      where b.id = calendar_items.business_id
        and b.owner_id = auth.uid()
    )
  );
