-- Make payout invoice references server-verifiable and keep private storage
-- access scoped to the payout owner or a global administrator.

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do update set public = false;

create or replace function public.can_access_invoice_storage_object(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_scope text := split_part(coalesce(p_object_name, ''), '/', 1);
  v_id_text text := split_part(coalesce(p_object_name, ''), '/', 2);
  v_entity_id uuid;
begin
  if auth.uid() is null then return false; end if;
  if public.can_admin_module('payouts') then return true; end if;

  if v_scope in ('payout', 'hourly_payout')
     and v_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_entity_id := v_id_text::uuid;
    if v_scope = 'payout' then
      return exists (
        select 1 from public.payouts p
        where p.id = v_entity_id and p.member_id = public.get_member_id()
      );
    end if;
    return exists (
      select 1 from public.hourly_payout_requests h
      where h.id = v_entity_id and h.member_id = public.get_member_id()
    );
  end if;

  -- Compatibility for existing root-level objects. Access is derived from the
  -- persisted payout reference instead of exposing the whole legacy folder.
  return exists (
    select 1 from public.payouts p
    where p.member_id = public.get_member_id()
      and regexp_replace(coalesce(p.invoice_url, ''), '^invoices/', '') = p_object_name
  ) or exists (
    select 1 from public.hourly_payout_requests h
    where h.member_id = public.get_member_id()
      and regexp_replace(coalesce(h.invoice_url, ''), '^invoices/', '') = p_object_name
  );
end;
$$;

create or replace function public.can_mutate_invoice_storage_object(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_scope text := split_part(coalesce(p_object_name, ''), '/', 1);
  v_id_text text := split_part(coalesce(p_object_name, ''), '/', 2);
  v_entity_id uuid;
begin
  if auth.uid() is null then return false; end if;
  if v_scope not in ('payout', 'hourly_payout')
     or v_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    -- Existing invoices were stored directly in the bucket root. Allow their
    -- owner (or an administrator) to remove them only while the linked payout
    -- is still waiting for payment.
    return exists (
      select 1 from public.payouts p
      where (public.can_admin_module('payouts') or p.member_id = public.get_member_id())
        and p.status = 'invoice_uploaded'
        and regexp_replace(coalesce(p.invoice_url, ''), '^invoices/', '') = p_object_name
    ) or exists (
      select 1 from public.hourly_payout_requests h
      where (public.can_admin_module('payouts') or h.member_id = public.get_member_id())
        and h.status = 'invoice_uploaded'
        and regexp_replace(coalesce(h.invoice_url, ''), '^invoices/', '') = p_object_name
    );
  end if;

  v_entity_id := v_id_text::uuid;
  if v_scope = 'payout' then
    return exists (
      select 1 from public.payouts p
      where p.id = v_entity_id
        and (public.can_admin_module('payouts') or p.member_id = public.get_member_id())
        and p.status in ('approved', 'invoice_uploaded')
    );
  end if;
  return exists (
    select 1 from public.hourly_payout_requests h
    where h.id = v_entity_id
      and (public.can_admin_module('payouts') or h.member_id = public.get_member_id())
      and h.status in ('approved', 'invoice_uploaded')
  );
end;
$$;

revoke all on function public.can_access_invoice_storage_object(text) from public, anon;
revoke all on function public.can_mutate_invoice_storage_object(text) from public, anon;
grant execute on function public.can_access_invoice_storage_object(text) to authenticated, service_role;
grant execute on function public.can_mutate_invoice_storage_object(text) to authenticated, service_role;

drop policy if exists "Payout invoice objects are readable by owner or admin" on storage.objects;
create policy "Payout invoice objects are readable by owner or admin"
on storage.objects for select to authenticated
using (bucket_id = 'invoices' and public.can_access_invoice_storage_object(name));

drop policy if exists "Payout invoice objects are uploadable by owner or admin" on storage.objects;
create policy "Payout invoice objects are uploadable by owner or admin"
on storage.objects for insert to authenticated
with check (bucket_id = 'invoices' and public.can_mutate_invoice_storage_object(name));

drop policy if exists "Payout invoice objects are removable by owner or admin" on storage.objects;
create policy "Payout invoice objects are removable by owner or admin"
on storage.objects for delete to authenticated
using (bucket_id = 'invoices' and public.can_mutate_invoice_storage_object(name));

create or replace function public.assert_payout_invoice_file_exists(
  p_entity_type text,
  p_entity_id uuid,
  p_invoice_url text,
  p_storage_provider text,
  p_storage_connection_id uuid,
  p_external_file_id text
)
returns void
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_provider text := coalesce(nullif(btrim(p_storage_provider), ''), 'supabase');
  v_object_name text;
begin
  if p_entity_type not in ('payout', 'hourly_payout') then
    raise exception 'Unsupported payout invoice owner';
  end if;

  if v_provider = 'supabase' then
    v_object_name := coalesce(
      nullif(btrim(p_external_file_id), ''),
      regexp_replace(nullif(btrim(p_invoice_url), ''), '^invoices/', '')
    );
    if v_object_name is null or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'invoices' and o.name = v_object_name
    ) then
      raise exception 'Uploaded invoice file was not found in private storage';
    end if;
    if not (
      v_object_name like p_entity_type || '/' || p_entity_id::text || '/%'
      or exists (
        select 1 from public.document_storage_files f
        where f.entity_type = 'invoice'
          and f.entity_id = p_entity_id
          and f.owner_type = p_entity_type
          and f.owner_id = p_entity_id
          and f.external_file_id = v_object_name
      )
    ) then
      raise exception 'Invoice file is not registered for this payout';
    end if;
    return;
  end if;

  if v_provider = 'sharepoint' then
    if p_storage_connection_id is null or nullif(btrim(p_external_file_id), '') is null then
      raise exception 'SharePoint invoice identity is incomplete';
    end if;
    if not exists (
      select 1 from public.document_storage_files f
      where f.connection_id = p_storage_connection_id
        and f.entity_type = 'invoice'
        and f.entity_id = p_entity_id
        and f.owner_type = p_entity_type
        and f.owner_id = p_entity_id
        and f.external_file_id = p_external_file_id
    ) then
      raise exception 'SharePoint invoice is not registered for this payout';
    end if;
    return;
  end if;

  raise exception 'Unsupported payout invoice storage provider %', v_provider;
end;
$$;

revoke all on function public.assert_payout_invoice_file_exists(text, uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.assert_payout_invoice_file_exists(text, uuid, text, text, uuid, text) to service_role;

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
  v_current_member_id uuid := public.get_member_id();
  v_can_admin boolean := public.can_admin_module('payouts');
  v_request public.hourly_payout_requests%rowtype;
begin
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

  perform public.assert_payout_invoice_file_exists(
    'hourly_payout', p_request_id, p_invoice_url, p_storage_provider,
    p_storage_connection_id, p_external_file_id
  );

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

  insert into public.audit_logs (user_id, user_email, action, details)
  values (
    auth.uid(), auth.jwt() ->> 'email', 'hourly_payout_invoice_uploaded',
    jsonb_build_object(
      'request_id', p_request_id,
      'member_id', v_request.member_id,
      'storage_provider', v_request.invoice_storage_provider,
      'storage_connection_id', v_request.invoice_storage_connection_id,
      'external_file_id', v_request.invoice_external_file_id,
      'invoice_url', v_request.invoice_url
    )
  );

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
  v_current_member_id uuid := public.get_member_id();
  v_can_admin boolean := coalesce(public.can_admin_module('payouts'), false);
  v_request public.hourly_payout_requests%rowtype;
  v_previous_invoice jsonb;
begin
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

  v_previous_invoice := jsonb_build_object(
    'invoice_url', v_request.invoice_url,
    'storage_provider', v_request.invoice_storage_provider,
    'storage_connection_id', v_request.invoice_storage_connection_id,
    'external_file_id', v_request.invoice_external_file_id,
    'metadata', v_request.invoice_storage_metadata
  );

  update public.hourly_payout_requests
  set invoice_url = null,
      invoice_uploaded_at = null,
      invoice_storage_provider = 'supabase',
      invoice_storage_connection_id = null,
      invoice_external_file_id = null,
      invoice_storage_metadata = '{}'::jsonb,
      status = 'approved',
      updated_at = now()
  where id = p_request_id
  returning * into v_request;

  insert into public.audit_logs (user_id, user_email, action, details)
  values (
    auth.uid(), auth.jwt() ->> 'email', 'hourly_payout_invoice_removed',
    jsonb_build_object(
      'request_id', p_request_id,
      'member_id', v_request.member_id,
      'previous_invoice', v_previous_invoice
    )
  );

  return to_jsonb(v_request);
end;
$$;

create or replace function public.clear_payout_invoice(p_payout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_can_admin boolean := coalesce(public.can_admin_module('payouts'), false);
  v_payout public.payouts%rowtype;
  v_previous_invoice jsonb;
begin
  select * into v_payout
  from public.payouts
  where id = p_payout_id
  for update;

  if not found then raise exception 'Payout request not found'; end if;
  if not v_can_admin and v_payout.member_id is distinct from v_current_member_id then
    raise exception 'Not allowed to remove invoice from this payout request';
  end if;
  if v_payout.status = 'paid' then
    raise exception 'Paid payout invoice cannot be removed';
  end if;
  if v_payout.status <> 'invoice_uploaded' or v_payout.invoice_url is null then
    raise exception 'This payout does not have a removable uploaded invoice';
  end if;

  v_previous_invoice := jsonb_build_object(
    'invoice_url', v_payout.invoice_url,
    'invoice_name', v_payout.invoice_name,
    'storage_provider', v_payout.invoice_storage_provider,
    'storage_connection_id', v_payout.invoice_storage_connection_id,
    'external_file_id', v_payout.invoice_external_file_id,
    'metadata', v_payout.invoice_storage_metadata
  );

  update public.payouts
  set invoice_url = null,
      invoice_name = null,
      invoice_uploaded_at = null,
      invoice_storage_provider = 'supabase',
      invoice_storage_connection_id = null,
      invoice_external_file_id = null,
      invoice_storage_metadata = '{}'::jsonb,
      status = 'approved'
  where id = p_payout_id
  returning * into v_payout;

  insert into public.audit_logs (user_id, user_email, action, details)
  values (
    auth.uid(), auth.jwt() ->> 'email', 'payout_invoice_removed',
    jsonb_build_object(
      'payout_id', p_payout_id,
      'member_id', v_payout.member_id,
      'previous_invoice', v_previous_invoice
    )
  );

  return to_jsonb(v_payout);
end;
$$;

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
  perform public.assert_payout_invoice_file_exists(
    'payout', p_payout_id, p_invoice_url, p_storage_provider,
    p_storage_connection_id, p_external_file_id
  );

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

-- Legacy endpoints accepted a caller-provided URL without storage proof.
revoke execute on function public.upload_hourly_payout_invoice(uuid, text) from authenticated;
revoke execute on function public.upload_payout_invoice(uuid, text, text) from authenticated;
revoke all on function public.clear_hourly_payout_invoice(uuid) from public, anon;
revoke all on function public.clear_payout_invoice(uuid) from public, anon;
grant execute on function public.upload_hourly_payout_invoice_v2(uuid, text, text, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.upload_payout_invoice_v2(uuid, text, text, text, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.clear_hourly_payout_invoice(uuid) to authenticated;
grant execute on function public.clear_payout_invoice(uuid) to authenticated;

create or replace function public.delete_payout_request(p_payout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_member_id uuid := public.get_member_id();
  v_can_admin boolean := coalesce(public.can_admin_module('payouts'), false);
  v_payout public.payouts%rowtype;
begin
  select * into v_payout from public.payouts where id = p_payout_id for update;
  if not found then raise exception 'Payout request not found'; end if;
  if not v_can_admin and v_payout.member_id is distinct from v_current_member_id then
    raise exception 'Not allowed to delete this payout request';
  end if;
  if v_payout.status <> 'pending' then
    raise exception 'Only pending payout requests can be deleted; use cancellation for processed requests';
  end if;
  if v_payout.invoice_url is not null then
    raise exception 'Payout request with an invoice cannot be deleted';
  end if;

  delete from public.payout_items where payout_id = p_payout_id;
  delete from public.payouts where id = p_payout_id;

  insert into public.audit_logs (user_id, user_email, action, details)
  values (
    auth.uid(), auth.jwt() ->> 'email', 'payout_deleted',
    jsonb_build_object('payout_id', p_payout_id, 'member_id', v_payout.member_id, 'status', v_payout.status)
  );
  return to_jsonb(v_payout);
end;
$$;

revoke all on function public.delete_payout_request(uuid) from public, anon;
grant execute on function public.delete_payout_request(uuid) to authenticated;
