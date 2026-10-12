-- Found in the 2026-10-13 audit: the insert policy of calendar_events (0061) only lets a replacement row point at one
-- of the caller's own series, but the update policy checked user_id alone. A customer could therefore update one of
-- their own rows through PostgREST to point at another user's series id and take that user's
-- (series_id, original_date) slot in calendar_events_series_day_unique, so the owner could no longer change that day.
-- The update policy now applies the same series check as the insert policy.

drop policy if exists "calendar_events_update_own" on public.calendar_events;

create policy "calendar_events_update_own" on public.calendar_events
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (series_id is null or exists (
      select 1 from public.calendar_events s where s.id = calendar_events.series_id and s.user_id = auth.uid() and s.recur_freq is not null
    ))
  );
