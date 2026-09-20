-- Automation Guides / Customer Support domain (owned by Dev3, Section 12).
create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  category text,
  is_published boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index faqs_category_idx on public.faqs (category);

create trigger set_faqs_updated_at
  before update on public.faqs
  for each row execute function public.set_updated_at();

alter table public.faqs enable row level security;

-- Public read for published FAQs. Writes go through the service-role
-- client (an admin script or future staff-only route) until this project
-- grows a real admin role concept.
create policy "faqs_select_published" on public.faqs
  for select using (is_published = true);
