-- ONE-TIME MANUAL SCRIPT — DO NOT move this file into supabase/migrations.
-- Run only after 0051_billing_products_and_credit_ledger.sql is deployed.
--
-- This preserves the unused part of an ACTIVE/TRIALING STARTER or PRO user's
-- current subscription period as expiring credits. It intentionally leaves
-- subscriptions and usage untouched so rollback and audit remain possible.
--
-- The 8/4 and 30/12 values below are a frozen snapshot of the legacy contracts
-- in src/server/billing/plans.ts. They are not definitions of the new products.
-- Re-running the script is safe: provider_order_id and order_id are unique and
-- grant_credit is idempotent per order.

begin;

do $$
declare
  v_row record;
  v_order_id uuid;
begin
  for v_row in
    with active_legacy as (
      select
        s.id as subscription_id,
        s.user_id,
        s.plan,
        coalesce(s.current_period_start, date_trunc('month', timezone('Asia/Seoul', now())) at time zone 'Asia/Seoul') as period_start,
        coalesce(s.current_period_end, timezone('utc', now()) + interval '30 days') as period_end,
        case s.plan when 'STARTER' then 8 when 'PRO' then 30 end as blog_limit,
        case s.plan when 'STARTER' then 4 when 'PRO' then 12 end as shorts_limit
      from public.subscriptions s
      where s.plan in ('STARTER', 'PRO')
        and s.status in ('ACTIVE', 'TRIALING')
        and coalesce(s.current_period_end, timezone('utc', now()) + interval '30 days') > timezone('utc', now())
    ),
    used as (
      select
        a.user_id,
        t.slug,
        count(*)::integer as used_count
      from public.automation_runs r
      join public.automations a on a.id = r.automation_id
      join public.automation_templates t on t.id = a.template_id
      join active_legacy l on l.user_id = a.user_id
      where r.status = 'SUCCESS'
        and r.completed_at >= l.period_start
        and r.completed_at < l.period_end
        and t.slug in ('blog-marketing', 'shorts')
      group by a.user_id, t.slug
    )
    select
      l.*,
      greatest(l.blog_limit - coalesce(b.used_count, 0), 0) as blog_remaining,
      greatest(l.shorts_limit - coalesce(s.used_count, 0), 0) as shorts_remaining
    from active_legacy l
    left join used b on b.user_id = l.user_id and b.slug = 'blog-marketing'
    left join used s on s.user_id = l.user_id and s.slug = 'shorts'
  loop
    if v_row.blog_remaining > 0 then
      v_order_id := null;
      insert into public.billing_orders (
        user_id, product_id, kind, credit_amount, price_krw, validity_days,
        status, provider, provider_order_id, paid_at
      ) values (
        v_row.user_id, 'LEGACY_' || v_row.plan || '_BLOG', 'BLOG',
        v_row.blog_remaining, 0, greatest(1, ceil(extract(epoch from (v_row.period_end - timezone('utc', now()))) / 86400)::integer),
        'PAID', 'legacy',
        'legacy:' || v_row.subscription_id || ':BLOG:' || extract(epoch from v_row.period_start)::bigint,
        timezone('utc', now())
      )
      on conflict (provider_order_id) do nothing
      returning id into v_order_id;

      if v_order_id is not null then
        perform public.grant_credit(
          v_row.user_id, 'BLOG', v_row.blog_remaining, v_row.period_end,
          v_order_id, 'legacy-subscription:' || v_row.subscription_id
        );
      end if;
    end if;

    if v_row.shorts_remaining > 0 then
      v_order_id := null;
      insert into public.billing_orders (
        user_id, product_id, kind, credit_amount, price_krw, validity_days,
        status, provider, provider_order_id, paid_at
      ) values (
        v_row.user_id, 'LEGACY_' || v_row.plan || '_SHORTS', 'SHORTS',
        v_row.shorts_remaining, 0, greatest(1, ceil(extract(epoch from (v_row.period_end - timezone('utc', now()))) / 86400)::integer),
        'PAID', 'legacy',
        'legacy:' || v_row.subscription_id || ':SHORTS:' || extract(epoch from v_row.period_start)::bigint,
        timezone('utc', now())
      )
      on conflict (provider_order_id) do nothing
      returning id into v_order_id;

      if v_order_id is not null then
        perform public.grant_credit(
          v_row.user_id, 'SHORTS', v_row.shorts_remaining, v_row.period_end,
          v_order_id, 'legacy-subscription:' || v_row.subscription_id
        );
      end if;
    end if;
  end loop;
end;
$$;

-- Review these rows before COMMIT when running interactively.
select product_id, kind, count(*) as orders, sum(credit_amount) as credits
from public.billing_orders
where provider = 'legacy'
group by product_id, kind
order by product_id, kind;

commit;

