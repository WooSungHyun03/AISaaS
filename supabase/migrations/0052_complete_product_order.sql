-- Completes a one-time product order and grants its credits in one database
-- transaction. Repeated calls for the same order return the original grant,
-- so a retried provider callback cannot issue credits twice.
create or replace function public.complete_billing_order(
  p_order_id uuid,
  p_payment_key text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.billing_orders%rowtype;
  v_session public.billing_checkout_sessions%rowtype;
  v_grant_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  if nullif(trim(p_payment_key), '') is null then
    raise exception 'payment key is required' using errcode = '22023';
  end if;

  select * into v_order
  from public.billing_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'billing order not found' using errcode = 'P0002';
  end if;
  if v_order.status in ('CANCELED', 'REFUNDED') then
    raise exception 'billing order cannot be completed from status %', v_order.status using errcode = '55000';
  end if;
  if v_order.checkout_session_id is null then
    raise exception 'billing order has no checkout session' using errcode = '55000';
  end if;

  select * into v_session
  from public.billing_checkout_sessions
  where id = v_order.checkout_session_id
  for update;

  if not found then
    raise exception 'checkout session not found' using errcode = 'P0002';
  end if;
  if v_session.user_id <> v_order.user_id
    or v_session.product_id <> v_order.product_id
    or v_session.order_id <> v_order.provider_order_id then
    raise exception 'checkout session does not match billing order' using errcode = '22023';
  end if;
  if v_session.status = 'CANCELED' then
    raise exception 'checkout session was canceled' using errcode = '55000';
  end if;
  if v_session.status = 'SUCCEEDED'
    and v_session.provider_payment_key is not null
    and v_session.provider_payment_key <> p_payment_key then
    raise exception 'payment key does not match completed checkout' using errcode = '22023';
  end if;

  if v_order.status = 'PENDING' then
    update public.billing_orders
    set status = 'PAID', paid_at = v_now
    where id = v_order.id;
  elsif v_order.status <> 'PAID' then
    raise exception 'unsupported billing order status: %', v_order.status using errcode = '55000';
  end if;

  update public.billing_checkout_sessions
  set status = 'SUCCEEDED',
      provider_payment_key = coalesce(provider_payment_key, p_payment_key),
      completed_at = coalesce(completed_at, v_now),
      error_code = null,
      error_message = null
  where id = v_session.id;

  v_grant_id := public.grant_credit(
    v_order.user_id,
    v_order.kind,
    v_order.credit_amount,
    v_now + make_interval(days => v_order.validity_days),
    v_order.id,
    v_order.provider_order_id
  );

  return v_grant_id;
end;
$$;

revoke all on function public.complete_billing_order(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_billing_order(uuid, text) to service_role;
