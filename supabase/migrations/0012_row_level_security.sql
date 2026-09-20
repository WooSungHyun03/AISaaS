-- Row Level Security: every table a user can reach directly is locked to
-- rows they own. Privileged writes (subscriptions, usage, automation_runs,
-- directory sync) go through the service-role client in src/lib/supabase/admin.ts,
-- which bypasses RLS entirely and is only ever called from trusted server code.

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.automation_templates enable row level security;
alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;
alter table public.content_history enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage enable row level security;
alter table public.setup_requests enable row level security;
alter table public.directory_tools enable row level security;

-- profiles: read/update your own row only.
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- businesses: full CRUD on rows you own.
create policy "businesses_select_own" on public.businesses
  for select using (auth.uid() = owner_id);
create policy "businesses_insert_own" on public.businesses
  for insert with check (auth.uid() = owner_id);
create policy "businesses_update_own" on public.businesses
  for update using (auth.uid() = owner_id);
create policy "businesses_delete_own" on public.businesses
  for delete using (auth.uid() = owner_id);

-- automation_templates: public catalog, readable by anyone, active only.
create policy "automation_templates_select_active" on public.automation_templates
  for select using (is_active = true);

-- automations: full CRUD on rows you own.
create policy "automations_select_own" on public.automations
  for select using (auth.uid() = user_id);
create policy "automations_insert_own" on public.automations
  for insert with check (auth.uid() = user_id);
create policy "automations_update_own" on public.automations
  for update using (auth.uid() = user_id);
create policy "automations_delete_own" on public.automations
  for delete using (auth.uid() = user_id);

-- automation_runs: read-only for the owning user; all writes happen via the
-- service-role runner so a user can never fake a SUCCESS run.
create policy "automation_runs_select_own" on public.automation_runs
  for select using (
    exists (
      select 1 from public.automations a
      where a.id = automation_runs.automation_id
        and a.user_id = auth.uid()
    )
  );

-- content_history: read-only for the owning business's user.
create policy "content_history_select_own" on public.content_history
  for select using (
    exists (
      select 1 from public.businesses b
      where b.id = content_history.business_id
        and b.owner_id = auth.uid()
    )
  );

-- subscriptions: read-only; plan changes happen via the billing webhook
-- using the service-role client.
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- usage: read-only; counters are incremented by server-side code only.
create policy "usage_select_own" on public.usage
  for select using (auth.uid() = user_id);

-- setup_requests: a user can create and track (and cancel) their own requests.
create policy "setup_requests_select_own" on public.setup_requests
  for select using (auth.uid() = user_id);
create policy "setup_requests_insert_own" on public.setup_requests
  for insert with check (auth.uid() = user_id);
create policy "setup_requests_update_own" on public.setup_requests
  for update using (auth.uid() = user_id);

-- directory_tools: public catalog, readable by anyone.
create policy "directory_tools_select_all" on public.directory_tools
  for select using (true);
