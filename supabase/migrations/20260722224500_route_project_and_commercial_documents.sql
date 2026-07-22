-- Route cost invoices to their project/realization storage and keep commercial
-- contracts and customer invoices in the private central Vedení storage.

update public.document_storage_connections
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
  'targets', coalesce(config -> 'targets', '{}'::jsonb) || jsonb_build_object(
    'project', coalesce(config #> '{targets,project}', '{}'::jsonb) || jsonb_build_object(
      'costInvoiceFolderPath', coalesce(nullif(config #>> '{targets,project,costInvoiceFolderPath}', ''), '04_Fakturace/Nakladove faktury')
    ),
    'realizace', coalesce(config #> '{targets,realizace}', '{}'::jsonb) || jsonb_build_object(
      'costInvoiceFolderPath', coalesce(nullif(config #>> '{targets,realizace,costInvoiceFolderPath}', ''), '02_Naklady/Faktury')
    ),
    'invoice', (coalesce(config #> '{targets,invoice}', '{}'::jsonb) - 'costInvoiceFolderPath') || jsonb_build_object(
      'commercialContractFolderPath', coalesce(nullif(config #>> '{targets,invoice,commercialContractFolderPath}', ''), 'Obchodni smlouvy'),
      'customerInvoiceFolderPath', coalesce(nullif(config #>> '{targets,invoice,customerInvoiceFolderPath}', ''), 'Odberatelske faktury')
    )
  )
)
where provider = 'sharepoint';

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

  if v_scope in ('payout', 'hourly_payout', 'project', 'realizace')
     and v_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_entity_id := v_id_text::uuid;
    if v_scope = 'payout' then
      return public.can_admin_module('payouts') or exists (
        select 1 from public.payouts p where p.id = v_entity_id and p.member_id = public.get_member_id()
      );
    elsif v_scope = 'hourly_payout' then
      return public.can_admin_module('payouts') or exists (
        select 1 from public.hourly_payout_requests h where h.id = v_entity_id and h.member_id = public.get_member_id()
      );
    elsif v_scope = 'project' then
      return public.can_view_project_financials() and public.can_access_project(v_entity_id);
    end if;
    return public.can_view_realization_financials() and public.can_access_realization(v_entity_id);
  end if;

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

  if v_scope in ('project', 'realizace')
     and v_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_entity_id := v_id_text::uuid;
    if v_scope = 'project' then
      return (public.can_edit_module('projects') or public.can_admin_module('projects'))
        and public.can_view_project_financials()
        and public.can_access_project(v_entity_id);
    end if;
    return (public.can_edit_module('realizace') or public.can_admin_module('realizace'))
      and public.can_view_realization_financials()
      and public.can_access_realization(v_entity_id);
  end if;

  if v_scope not in ('payout', 'hourly_payout')
     or v_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
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

create or replace function public.can_access_cost_invoice_storage_object(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_prefix text := split_part(coalesce(p_object_name, ''), '/', 1);
  v_scope text := split_part(coalesce(p_object_name, ''), '/', 2);
  v_id_text text := split_part(coalesce(p_object_name, ''), '/', 3);
  v_entity_id uuid;
begin
  if auth.uid() is null or v_prefix <> 'cost-invoices' then return false; end if;
  if v_scope not in ('project', 'realizace')
     or v_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_entity_id := v_id_text::uuid;
  if v_scope = 'project' then
    return public.can_view_project_financials() and public.can_access_project(v_entity_id);
  end if;
  return public.can_view_realization_financials() and public.can_access_realization(v_entity_id);
end;
$$;

create or replace function public.can_mutate_cost_invoice_storage_object(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_scope text := split_part(coalesce(p_object_name, ''), '/', 2);
begin
  if not public.can_access_cost_invoice_storage_object(p_object_name) then return false; end if;
  if v_scope = 'project' then
    return public.can_edit_module('projects') or public.can_admin_module('projects');
  end if;
  return public.can_edit_module('realizace') or public.can_admin_module('realizace');
end;
$$;

revoke all on function public.can_access_cost_invoice_storage_object(text) from public, anon;
revoke all on function public.can_mutate_cost_invoice_storage_object(text) from public, anon;
grant execute on function public.can_access_cost_invoice_storage_object(text) to authenticated, service_role;
grant execute on function public.can_mutate_cost_invoice_storage_object(text) to authenticated, service_role;

drop policy if exists "Cost invoice objects are readable by project finance" on storage.objects;
create policy "Cost invoice objects are readable by project finance"
on storage.objects for select to authenticated
using (bucket_id = 'project-files' and public.can_access_cost_invoice_storage_object(name));

drop policy if exists "Cost invoice objects are uploadable by project finance" on storage.objects;
create policy "Cost invoice objects are uploadable by project finance"
on storage.objects for insert to authenticated
with check (bucket_id = 'project-files' and public.can_mutate_cost_invoice_storage_object(name));

drop policy if exists "Cost invoice objects are removable by project finance" on storage.objects;
create policy "Cost invoice objects are removable by project finance"
on storage.objects for delete to authenticated
using (bucket_id = 'project-files' and public.can_mutate_cost_invoice_storage_object(name));
