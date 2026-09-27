-- Structured intake fields for the paid automation setup funnel. Keep the
-- legacy description column for optional notes and backwards compatibility.
alter table public.setup_requests
  add column current_work text,
  add column desired_outcome text,
  add column contact_method text check (contact_method in ('EMAIL', 'PHONE', 'KAKAO', 'OTHER')),
  add column contact_value text;

create index setup_requests_user_created_idx
  on public.setup_requests (user_id, created_at desc);

-- Users may read and create their own requests, but operational progress is
-- controlled by the service team. Limit the old broad UPDATE policy to a
-- one-way user cancellation; service-role updates still bypass RLS.
drop policy if exists "setup_requests_update_own" on public.setup_requests;
create policy "setup_requests_cancel_own" on public.setup_requests
  for update
  using (auth.uid() = user_id and status in ('REQUESTED', 'CONTACTED'))
  with check (auth.uid() = user_id and status = 'CANCELLED');
