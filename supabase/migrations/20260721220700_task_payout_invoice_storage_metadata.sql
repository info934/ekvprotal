alter table public.payouts
  add column if not exists invoice_storage_provider text not null default 'supabase',
  add column if not exists invoice_storage_connection_id uuid references public.document_storage_connections(id) on delete set null,
  add column if not exists invoice_external_file_id text,
  add column if not exists invoice_storage_metadata jsonb not null default '{}'::jsonb;

create index if not exists idx_payout_invoice_external_file
  on public.payouts(invoice_external_file_id)
  where invoice_external_file_id is not null;

insert into public.document_storage_files (
  connection_id, entity_type, entity_id, owner_type, owner_id,
  external_file_id, file_name, external_web_url, metadata
)
select
  p.invoice_storage_connection_id, 'invoice', p.id, 'payout', p.id,
  p.invoice_external_file_id, coalesce(p.invoice_name, 'faktura'),
  case when p.invoice_url ~ '^https?://' then p.invoice_url else null end,
  coalesce(p.invoice_storage_metadata, '{}'::jsonb)
from public.payouts p
where p.invoice_storage_connection_id is not null
  and p.invoice_external_file_id is not null
on conflict (connection_id, external_file_id) do nothing;

create or replace function public.upload_payout_invoice_v2(
  p_payout_id uuid,
  p_invoice_url text,
  p_invoice_name text,
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
  v_payout jsonb;
  v_updated public.payouts%rowtype;
begin
  if coalesce(nullif(p_storage_provider, ''), 'supabase') not in ('supabase', 'sharepoint', 'google_drive') then
    raise exception 'Unsupported invoice storage provider';
  end if;

  v_payout := public.upload_payout_invoice(p_payout_id, p_invoice_url, p_invoice_name);

  update public.payouts
  set invoice_storage_provider = coalesce(nullif(p_storage_provider, ''), 'supabase'),
      invoice_storage_connection_id = p_storage_connection_id,
      invoice_external_file_id = p_external_file_id,
      invoice_storage_metadata = coalesce(p_storage_metadata, '{}'::jsonb)
  where id = p_payout_id
  returning * into v_updated;

  return to_jsonb(v_updated);
end;
$$;

revoke all on function public.upload_payout_invoice_v2(uuid, text, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.upload_payout_invoice_v2(uuid, text, text, text, uuid, text, jsonb) to authenticated, service_role;
