-- Database-backed administrator membership and immutable audit history.
-- No customer role receives a policy or table privilege on either table.

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  -- Deliberately not a foreign key: audit rows must not be mutated when an
  -- Auth user is deleted. The UUID is historical evidence, not a live link.
  actor_user_id uuid,
  actor_email text,
  action text not null check (char_length(btrim(action)) between 3 and 100),
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_idx on public.admin_audit_log(created_at desc);
create index admin_audit_log_actor_created_idx on public.admin_audit_log(actor_user_id, created_at desc);
create index admin_audit_log_action_created_idx on public.admin_audit_log(action, created_at desc);

create or replace function public.prevent_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'admin_audit_log is append-only';
end;
$$;

create trigger admin_audit_log_immutable
  before update or delete on public.admin_audit_log
  for each row execute function public.prevent_admin_audit_mutation();

alter table public.admin_users enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on table public.admin_users from public, anon, authenticated;
revoke all on table public.admin_audit_log from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_users to service_role;
grant select, insert on table public.admin_audit_log to service_role;
revoke update, delete, truncate on table public.admin_audit_log from service_role;
revoke all on function public.prevent_admin_audit_mutation() from public, anon, authenticated;

-- Exact counts for the admin dashboard. Active means a user with an actual
-- credit-backed execution event during the requested window; signup grants
-- alone do not count as activity.
create or replace function public.get_admin_dashboard_counts(p_active_since timestamptz)
returns table (
  total_users bigint,
  active_users bigint,
  paid_users bigint,
  blog_generations bigint,
  shorts_generations bigint
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    (select count(*) from public.profiles),
    (select count(distinct user_id)
       from public.credit_ledger
      where created_at >= p_active_since
        and event_type in ('RESERVE', 'SETTLE', 'RELEASE')),
    (select count(distinct user_id) from public.billing_orders where status = 'PAID'),
    (select count(*) from public.content_history where content_type = 'blog'),
    (select count(*) from public.content_history where content_type = 'shorts');
$$;

revoke all on function public.get_admin_dashboard_counts(timestamptz) from public, anon, authenticated;
grant execute on function public.get_admin_dashboard_counts(timestamptz) to service_role;

