-- Hardening (Claude daily audit, 2026-10-11): the insert policies from 0035
-- (channel_diagnoses) and 0042 (channel_growth_narratives) only check that
-- business_id is the caller's own — not that channel_id belongs to that same
-- business. A user could file rows against another business's channel id
-- under their own business. Recreate both policies with the extra check.
drop policy if exists "channel_diagnoses_insert_own" on public.channel_diagnoses;
create policy "channel_diagnoses_insert_own" on public.channel_diagnoses
  for insert with check (
    exists (
      select 1 from public.tracked_channels c
      join public.businesses b on b.id = c.business_id
      where c.id = channel_diagnoses.channel_id
        and c.business_id = channel_diagnoses.business_id
        and b.owner_id = auth.uid()
    )
  );

drop policy if exists "channel_growth_narratives_insert_own" on public.channel_growth_narratives;
create policy "channel_growth_narratives_insert_own" on public.channel_growth_narratives
  for insert with check (
    exists (
      select 1 from public.tracked_channels c
      join public.businesses b on b.id = c.business_id
      where c.id = channel_growth_narratives.channel_id
        and c.business_id = channel_growth_narratives.business_id
        and b.owner_id = auth.uid()
    )
  );
