-- Foundation for storing a user's external platform connections (WordPress
-- today; Instagram/Resend/YouTube later) so automations can look up "is this
-- business connected, and to what" without any raw credential ever sitting
-- in a plaintext table column. See docs/ARCHITECTURE.md "Integration
-- Connections & Secret Storage" for the full design.

-- Attempt to enable Supabase Vault, which provides `vault.create_secret` /
-- `vault.update_secret` / `vault.decrypted_secrets` for encrypted-at-rest
-- secret storage. On Supabase-hosted projects this extension is provided by
-- the platform; some local/self-hosted Postgres instances may not have it
-- installable. If it can't be created here, this migration still succeeds
-- (Postgres doesn't validate a SQL-language function body's object
-- references until the function is actually called) but the wrapper
-- functions below will raise a clear error the first time a caller tries to
-- store/read a secret — this deliberately fails closed rather than ever
-- falling back to a plaintext column.
do $$
begin
  create extension if not exists "supabase_vault" cascade;
exception
  when others then
    raise notice 'supabase_vault extension could not be created (%). integration_secret_* functions will fail until Vault is enabled for this project.', sqlerrm;
end;
$$;

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  -- text, not an enum type, so a new provider never needs an ALTER TYPE
  -- migration — validity is enforced by this check constraint instead.
  provider text not null check (provider in ('wordpress', 'instagram', 'email', 'youtube')),
  -- Non-secret label shown in the UI, e.g. the WordPress site URL or the IG
  -- username. Never a token/password.
  account_identifier text,
  status text not null default 'CONNECTED' check (status in ('CONNECTED', 'EXPIRED', 'ERROR', 'DISCONNECTED')),
  -- Vault secret id (vault.secrets.id) holding the real token/app password.
  -- Null for a connection that has no secret yet, or after disconnect.
  secret_reference uuid,
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  -- Reconnecting the same provider for a business updates its existing row
  -- (and its existing Vault secret) instead of accumulating duplicates.
  unique (business_id, provider)
);

create index integration_connections_user_id_idx on public.integration_connections (user_id);
create index integration_connections_business_id_idx on public.integration_connections (business_id);

create trigger set_integration_connections_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

alter table public.integration_connections enable row level security;

-- Owner can read their own connections (to show "connected to https://...").
-- No insert/update/delete policy: every write goes through the
-- service-role client in src/server/connectors/integrations.ts, which also
-- owns writing/rotating/deleting the paired Vault secret.
create policy "integration_connections_select_own" on public.integration_connections
  for select using (auth.uid() = user_id);

-- Thin SECURITY DEFINER wrappers around Vault so application code never
-- needs direct access to the `vault` schema (which PostgREST does not
-- expose, and which only the service-role Postgres role should touch).
-- Each function is revoked from anon/authenticated/public and granted only
-- to service_role, matching every other privileged write path in this
-- schema (usage, subscriptions, automation_runs).

create or replace function public.integration_secret_create(p_secret text, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return vault.create_secret(p_secret, p_name);
end;
$$;

create or replace function public.integration_secret_update(p_id uuid, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform vault.update_secret(p_id, p_secret);
end;
$$;

create or replace function public.integration_secret_read(p_id uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;

create or replace function public.integration_secret_delete(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where id = p_id;
$$;

revoke all on function public.integration_secret_create(text, text) from public, anon, authenticated;
revoke all on function public.integration_secret_update(uuid, text) from public, anon, authenticated;
revoke all on function public.integration_secret_read(uuid) from public, anon, authenticated;
revoke all on function public.integration_secret_delete(uuid) from public, anon, authenticated;

grant execute on function public.integration_secret_create(text, text) to service_role;
grant execute on function public.integration_secret_update(uuid, text) to service_role;
grant execute on function public.integration_secret_read(uuid) to service_role;
grant execute on function public.integration_secret_delete(uuid) to service_role;
