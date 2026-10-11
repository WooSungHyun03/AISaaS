-- Refund approval must not race an in-flight generation (Claude audit F-010).
--
-- reserve_credit (0066) already stops new reservations on an APPROVED order,
-- but a reservation opened before approval could still be RELEASED (failed
-- run) between approval and execution. release_credit returns the credit to
-- the grant, so admin_finalize_refund_request then sees more remaining
-- credits than the approved snapshot and raises — after Toss has already
-- cancelled the payment. Every retry hits the same mismatch, leaving the
-- order PAID locally while the payment is cancelled.
--
-- Same function as 0066 plus one check: approval is refused while any
-- reservation on the order's grants is still open (no SETTLE/RELEASE yet).

create or replace function public.admin_review_refund_request(
  p_request_id uuid,
  p_admin_id uuid,
  p_decision text,
  p_note text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.refund_requests%rowtype;
  v_order public.billing_orders%rowtype;
  v_remaining integer;
  v_next_status text;
begin
  if p_decision not in ('REVIEWING', 'APPROVED', 'REJECTED') then
    raise exception 'unsupported refund decision' using errcode = '22023';
  end if;
  if not exists (select 1 from public.admin_users where user_id = p_admin_id) then
    raise exception 'administrator membership required' using errcode = '42501';
  end if;

  select * into v_request from public.refund_requests where id = p_request_id for update;
  if not found then raise exception 'refund request not found' using errcode = 'P0002'; end if;
  if v_request.status = 'REFUNDED' then return 'REFUNDED'; end if;

  if p_decision = 'REVIEWING' and v_request.status <> 'REQUESTED' then
    raise exception 'only requested refunds can enter review' using errcode = '55000';
  end if;
  if p_decision in ('APPROVED', 'REJECTED') and v_request.status not in ('REQUESTED', 'REVIEWING') then
    raise exception 'refund request is not reviewable' using errcode = '55000';
  end if;

  if p_decision = 'APPROVED' then
    select * into v_order from public.billing_orders where id = v_request.order_id for update;
    if not found or v_order.status <> 'PAID' then
      raise exception 'only a paid order can be approved' using errcode = '55000';
    end if;
    select remaining into v_remaining
    from public.credit_grants where order_id = v_request.order_id for update;
    v_remaining := coalesce(v_remaining, 0);
    if v_remaining <> v_request.unused_credits_snapshot then
      raise exception 'credit balance changed after the refund request' using errcode = '55000';
    end if;
    -- A generation that reserved this order's credit before approval may
    -- still RELEASE it afterwards (release_credit adds it back to the grant).
    -- That would make admin_finalize_refund_request fail after Toss has
    -- already cancelled the payment, so approval waits for it to finish.
    if exists (
      select 1
      from public.credit_ledger reserve
      join public.credit_grants g on g.id = reserve.grant_id
      where g.order_id = v_request.order_id
        and reserve.event_type = 'RESERVE'
        and not exists (
          select 1 from public.credit_ledger closing
          where closing.reservation_id = reserve.reservation_id
            and closing.event_type in ('SETTLE', 'RELEASE')
        )
    ) then
      raise exception 'a generation using this order''s credits is still running; approve after it finishes' using errcode = '55000';
    end if;
  end if;

  v_next_status := p_decision;
  update public.refund_requests
  set status = v_next_status,
      reviewed_by = p_admin_id,
      reviewed_at = timezone('utc', now()),
      review_note = nullif(btrim(p_note), ''),
      refund_idempotency_key = case when p_decision = 'APPROVED' then coalesce(refund_idempotency_key, 'refund-' || id::text) else refund_idempotency_key end,
      refund_last_error = case when p_decision = 'APPROVED' then null else refund_last_error end
  where id = p_request_id;
  return v_next_status;
end;
$$;

revoke all on function public.admin_review_refund_request(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_review_refund_request(uuid, uuid, text, text) to service_role;
