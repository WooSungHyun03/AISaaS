-- WordPress delivery and the newsletter/email service are no longer part of the product: blog posts are written for the
-- owner to review and post by hand, and only YouTube and Instagram connect to the app.
--
-- Credentials go first (the stored secrets are the only sensitive part), then the connection rows, the old settings
-- inside blog automations, and the provider list. Subscriber lists (0026) are customer data and are left untouched.

-- 1. Vault secrets of the removed connections (vault may be absent on a bare local Postgres).
do $$
begin
  if to_regclass('vault.secrets') is not null then
    delete from vault.secrets
    where id in (
      select secret_reference from public.integration_connections
      where provider in ('wordpress', 'email') and secret_reference is not null
    );
  end if;
end;
$$;

delete from public.integration_connections where provider in ('wordpress', 'email');

alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections
  add constraint integration_connections_provider_check check (provider in ('instagram', 'youtube'));

-- 2. Blog automations that were set up for WordPress delivery become plain "write for me" automations; the encrypted
--    WordPress application password stored in their config is removed.
update public.automations
set config = (config - 'wordpress') || jsonb_build_object('deliveryMode', 'app_draft')
where config ? 'wordpress' or config ->> 'deliveryMode' like 'wordpress%';

-- 3. The newsletter template can no longer be started.
update public.automation_templates set is_active = false where slug = 'newsletter';
