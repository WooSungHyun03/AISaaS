create table public.directory_tools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  github_url text,
  stars integer not null default 0,
  forks integer not null default 0,
  language text,
  license text,
  category text,
  tags text[] not null default '{}',
  last_github_sync_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index directory_tools_category_idx on public.directory_tools (category);

create trigger set_directory_tools_updated_at
  before update on public.directory_tools
  for each row execute function public.set_updated_at();
