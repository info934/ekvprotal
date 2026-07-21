alter table public.hourly_payout_requests
  add column if not exists invoice_storage_provider text not null default 'supabase',
  add column if not exists invoice_storage_connection_id uuid references public.document_storage_connections(id) on delete set null,
  add column if not exists invoice_external_file_id text,
  add column if not exists invoice_storage_metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_hourly_payout_invoice_external_file
  on public.hourly_payout_requests (invoice_external_file_id)
  where invoice_external_file_id is not null;

insert into public.document_storage_files (
  connection_id, entity_type, entity_id, owner_type, owner_id,
  external_file_id, file_name, external_web_url, metadata
)
select
  h.invoice_storage_connection_id, 'invoice', h.id, 'hourly_payout', h.id,
  h.invoice_external_file_id,
  coalesce(nullif(h.invoice_storage_metadata ->> 'originalFileName', ''), 'faktura'),
  case when h.invoice_url ~ '^https?://' then h.invoice_url else null end,
  coalesce(h.invoice_storage_metadata, '{}'::jsonb)
from public.hourly_payout_requests h
where h.invoice_storage_connection_id is not null
  and h.invoice_external_file_id is not null
on conflict (connection_id, external_file_id) do nothing;

create or replace function public.upload_hourly_payout_invoice_v2(
  p_request_id uuid,
  p_invoice_url text,
  p_storage_provider text default 'supabase',
  p_storage_connection_id uuid default null,
  p_external_file_id text default null,
  p_storage_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_member_id uuid;
  v_can_admin boolean;
  v_request public.hourly_payout_requests%rowtype;
begin
  v_current_member_id := public.get_member_id();
  v_can_admin := public.can_admin_module('payouts');

  if nullif(btrim(p_invoice_url), '') is null then raise exception 'Invoice path is required'; end if;
  if coalesce(nullif(p_storage_provider, ''), 'supabase') not in ('supabase', 'sharepoint', 'google_drive') then
    raise exception 'Unsupported invoice storage provider';
  end if;

  select * into v_request
  from public.hourly_payout_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'Hourly payout request not found'; end if;
  if not v_can_admin and v_request.member_id is distinct from v_current_member_id then
    raise exception 'Not allowed to upload invoice for this request';
  end if;
  if v_request.status <> 'approved' then
    raise exception 'Cannot upload invoice for hourly payout with status %', v_request.status;
  end if;
  if coalesce(v_request.approved_without_invoice, false) then
    raise exception 'This request was approved without invoice';
  end if;

  update public.hourly_payout_requests
  set invoice_url = p_invoice_url,
      invoice_uploaded_at = now(),
      invoice_storage_provider = coalesce(nullif(p_storage_provider, ''), 'supabase'),
      invoice_storage_connection_id = p_storage_connection_id,
      invoice_external_file_id = p_external_file_id,
      invoice_storage_metadata = coalesce(p_storage_metadata, '{}'::jsonb),
      status = 'invoice_uploaded',
      updated_at = now()
  where id = p_request_id
  returning * into v_request;

  return to_jsonb(v_request);
end;
$$;

create or replace function public.clear_hourly_payout_invoice(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_member_id uuid;
  v_can_admin boolean;
  v_request public.hourly_payout_requests%rowtype;
begin
  v_current_member_id := public.get_member_id();
  v_can_admin := public.can_admin_module('payouts');

  select * into v_request
  from public.hourly_payout_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'Hourly payout request not found'; end if;
  if not v_can_admin and v_request.member_id is distinct from v_current_member_id then
    raise exception 'Not allowed to remove invoice from this request';
  end if;
  if v_request.status = 'paid' then
    raise exception 'Paid payout invoice cannot be removed';
  end if;
  if v_request.status <> 'invoice_uploaded' or v_request.invoice_url is null then
    raise exception 'This request does not have a removable uploaded invoice';
  end if;

  update public.hourly_payout_requests
  set invoice_url = null,
      invoice_uploaded_at = null,
      invoice_storage_provider = 'supabase',
      invoice_storage_connection_id = null,
      invoice_external_file_id = null,
      invoice_storage_metadata = '{}'::jsonb,
      status = 'approved',
      updated_at = now()
  where id = p_request_id;

  select * into v_request
  from public.hourly_payout_requests
  where id = p_request_id;

  return to_jsonb(v_request);
end;
$$;

revoke all on function public.upload_hourly_payout_invoice_v2(uuid, text, text, uuid, text, jsonb) from public, anon;
revoke all on function public.clear_hourly_payout_invoice(uuid) from public, anon;
grant execute on function public.upload_hourly_payout_invoice_v2(uuid, text, text, uuid, text, jsonb) to authenticated;
grant execute on function public.clear_hourly_payout_invoice(uuid) to authenticated;
