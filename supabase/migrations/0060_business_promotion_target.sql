-- What a business promotes: a store, a product or a platform (web service / app / SaaS).
-- The type decides which questions are asked and how blog posts and Shorts are planned.
-- Shared answers keep living in the existing columns (name, industry, location, target_customer,
-- main_offering, strengths, website); only what has no column yet goes into promotion_details:
--   problem     the problem the product / platform solves
--   price_info  price or promotion (store, product)
--   action_url  where a reader should go next (purchase URL / sign-up URL)
--   flow        the main way people use the platform
-- NULL promotion_type = the owner has not chosen yet (existing rows); generation asks for it first.
alter table public.businesses
  add column promotion_type text,
  add column promotion_details jsonb not null default '{}'::jsonb;

alter table public.businesses
  add constraint businesses_promotion_type_check
  check (promotion_type is null or promotion_type in ('STORE', 'PRODUCT', 'PLATFORM'));

alter table public.businesses
  add constraint businesses_promotion_details_is_object
  check (jsonb_typeof(promotion_details) = 'object');
