-- Extensions used across later migrations.
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- Shared trigger: keeps `updated_at` current on every row update.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;
