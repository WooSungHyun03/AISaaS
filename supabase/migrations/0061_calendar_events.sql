-- General-purpose calendar events: the owner's own schedule, independent of any business profile or marketing plan.
-- Marketing plan items keep living in calendar_items; the calendar screen shows both side by side.
--
-- Times are stored as UTC instants. The service runs on Korean time (no daylight saving), so a recurring
-- event keeps its Seoul wall-clock time; recurrence is computed on Seoul calendar dates in application code.
--
--   all_day events:  starts_at = Seoul midnight of the first day, ends_at = Seoul midnight AFTER the last day.
--   a series:        recur_freq is set; exdates lists Seoul dates whose occurrence was deleted or replaced.
--   a changed day:   a row with series_id + original_date replaces one occurrence of its series (no recurrence of its own).
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  color text not null default 'blue'
    check (color in ('blue', 'green', 'red', 'orange', 'purple', 'gray')),
  category text not null default 'GENERAL'
    check (category in ('GENERAL', 'MARKETING', 'MEETING', 'DEADLINE', 'PERSONAL')),

  recur_freq text check (recur_freq is null or recur_freq in ('DAILY', 'WEEKLY', 'MONTHLY')),
  recur_interval smallint not null default 1 check (recur_interval between 1 and 52),
  -- WEEKLY only: weekdays as 0 (Sunday) .. 6 (Saturday). Empty/null = the weekday of starts_at.
  recur_weekdays smallint[] check (recur_weekdays is null or recur_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  recur_until date,
  recur_count integer check (recur_count is null or recur_count between 1 and 500),
  exdates date[] not null default '{}',

  series_id uuid references public.calendar_events (id) on delete cascade,
  original_date date,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  check (ends_at >= starts_at),
  -- A changed occurrence knows its series and which day it replaces, and never repeats itself.
  check ((series_id is null) = (original_date is null)),
  check (series_id is null or recur_freq is null),
  check (recur_until is null or recur_freq is not null),
  check (recur_count is null or recur_freq is not null)
);

create index calendar_events_user_start_idx on public.calendar_events (user_id, starts_at);
create index calendar_events_series_idx on public.calendar_events (series_id) where series_id is not null;
-- One replacement per occurrence day of a series.
create unique index calendar_events_series_day_unique on public.calendar_events (series_id, original_date) where series_id is not null;

create trigger set_calendar_events_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

alter table public.calendar_events enable row level security;

create policy "calendar_events_select_own" on public.calendar_events
  for select using (auth.uid() = user_id);

create policy "calendar_events_insert_own" on public.calendar_events
  for insert with check (
    auth.uid() = user_id
    -- a replacement may only point at one of the caller's own series
    and (series_id is null or exists (
      select 1 from public.calendar_events s where s.id = calendar_events.series_id and s.user_id = auth.uid() and s.recur_freq is not null
    ))
  );

create policy "calendar_events_update_own" on public.calendar_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "calendar_events_delete_own" on public.calendar_events
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.calendar_events to authenticated;
