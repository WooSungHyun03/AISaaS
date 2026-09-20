create table public.automation_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  category text not null,
  icon text,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);
