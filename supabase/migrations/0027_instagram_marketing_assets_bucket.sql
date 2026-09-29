-- Instagram Publishing (Day 9): a public Storage bucket holding the single
-- static marketing-card image every Instagram post uses as its image_url,
-- so Meta's Graph API can fetch it by URL. See docs/ARCHITECTURE.md
-- "Instagram Publishing (Day 9)" for the full design. The bucket holds no
-- user data — only this one shared marketing asset, uploaded by
-- src/server/connectors/instagram/media.ts through the service-role client.
insert into storage.buckets (id, name, public)
values ('marketing-assets', 'marketing-assets', true)
on conflict (id) do nothing;

alter table storage.objects enable row level security;

-- Anyone (including Meta's unauthenticated image fetch) may read an object
-- in this bucket. Writes are never granted to anon/authenticated — only the
-- service-role client (which bypasses RLS entirely, see
-- src/lib/supabase/admin.ts) uploads here, matching every other table's
-- service-role-only write pattern in this repo.
create policy "marketing_assets_public_read" on storage.objects
  for select using (bucket_id = 'marketing-assets');
