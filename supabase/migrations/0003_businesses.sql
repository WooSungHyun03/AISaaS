create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  industry text,
  description text,
  location text,
  target_customer text,
  brand_tone text,
  keywords text[] not null default '{}',
  website text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index businesses_owner_id_idx on public.businesses (owner_id);

create trigger set_businesses_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();
