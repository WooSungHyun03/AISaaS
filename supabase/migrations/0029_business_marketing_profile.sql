-- Extends `businesses` with a few extra marketing-profile fields the AI
-- website diagnosis (0028_marketing_diagnoses.sql) can suggest values for:
-- found social links, main offering, strengths, and marketing goal. Plain
-- `alter table ... add column` — no RLS change needed, since businesses'
-- existing row-level policies (0012_row_level_security.sql) already cover
-- every column on the row, not specific ones.
alter table public.businesses
  add column sns_links jsonb not null default '{}'::jsonb,
  add column main_offering text,
  add column strengths text,
  add column marketing_goal text;
