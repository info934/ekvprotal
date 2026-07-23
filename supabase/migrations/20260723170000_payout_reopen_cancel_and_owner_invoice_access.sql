-- Keep payout history auditable while allowing a safe correction before payment.
alter table public.payouts
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancellation_reason text;

create or replace function public.reopen_payout_for_review(p_payout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.payouts%rowtype;
begin
  if not coalesce(public.can_admin_module('payouts'), false) then
    raise exception 'Only a payout administrator can return a payout for review';
  end if;

  select * into v_payout
  from public.payouts
  where id = p_payout_id
  for update;

  if not found then
    raise exception 'Payout request not found';
  end if;
  if v_payout.status <> 'approved' then
    raise exception 'Only an approved payout without an uploaded invoice can be returned for review';
  end if;
  if v_payout.invoice_url is not null then
    raise exception 'Remove the uploaded invoice before returning this payout for review';
  end if;

  update public.payouts
  set status = 'pending',
      approved_at = null,
      approved_by = null,
      approved_without_invoice = false
  where id = p_payout_id
  returning * into v_payout;

  insert into public.audit_logs (user_id, user_email, action, details)
  values (
    auth.uid(),
    auth.jwt() ->> 'email',
    'payout_reopened_for_review',
    jsonb_build_object('payout_id', p_payout_id, 'member_id', v_payout.member_id)
  );

  return to_jsonb(v_payout);
end;
$$;

create or replace function public.cancel_payout_request(
  p_payout_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_can_admin boolean := coalesce(public.can_admin_module('payouts'), false);
  v_payout public.payouts%rowtype;
  v_previous_status text;
begin
  select * into v_payout
  from public.payouts
  where id = p_payout_id
  for update;

  if not found then
    raise exception 'Payout request not found';
  end if;
  if not v_can_admin and v_payout.member_id is distinct from v_current_member_id then
    raise exception 'Not allowed to cancel this payout request';
  end if;
  if v_payout.status = 'paid' then
    raise exception 'A paid payout cannot be cancelled';
  end if;
  if v_payout.status = 'cancelled' then
    raise exception 'This payout is already cancelled';
  end if;
  if v_payout.status not in ('approved', 'invoice_uploaded') then
    raise exception 'Only an approved or invoiced payout can be cancelled';
  end if;
  if v_payout.status = 'invoice_uploaded' and not v_can_admin then
    raise exception 'Only a payout administrator can cancel a payout after an invoice was uploaded';
  end if;
  v_previous_status := v_payout.status;

  update public.payouts
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = coalesce(nullif(btrim(p_reason), ''), 'Stornováno před vyplacením')
  where id = p_payout_id
  returning * into v_payout;

  insert into public.audit_logs (user_id, user_email, action, details)
  values (
    auth.uid(),
    auth.jwt() ->> 'email',
    'payout_cancelled',
    jsonb_build_object(
      'payout_id', p_payout_id,
      'member_id', v_payout.member_id,
      'previous_status', v_previous_status,
      'reason', v_payout.cancellation_reason,
      'invoice_retained', v_payout.invoice_url is not null
    )
  );

  return to_jsonb(v_payout);
end;
$$;

revoke all on function public.reopen_payout_for_review(uuid) from public, anon;
revoke all on function public.cancel_payout_request(uuid, text) from public, anon;
grant execute on function public.reopen_payout_for_review(uuid) to authenticated;
grant execute on function public.cancel_payout_request(uuid, text) to authenticated;
