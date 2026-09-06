begin;

alter table public.crm_commercial_documents
  add column if not exists current_version integer not null default 0,
  add column if not exists sent_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists responded_at timestamptz,
  add column if not exists response_note text,
  add column if not exists reminder_count integer not null default 0,
  add column if not exists last_reminder_at timestamptz,
  add column if not exists source_document_id uuid references public.crm_commercial_documents(id) on delete set null;

create unique index if not exists uq_crm_order_source_offer
  on public.crm_commercial_documents(source_document_id)
  where type = 'order' and source_document_id is not null and deleted_at is null;

alter table public.crm_opportunity_items
  add column if not exists section_name text,
  add column if not exists item_kind text not null default 'standard',
  add column if not exists alternative_group text,
  add column if not exists included_in_total boolean not null default true;

alter table public.crm_commercial_document_items
  add column if not exists section_name text,
  add column if not exists item_kind text not null default 'standard',
  add column if not exists alternative_group text,
  add column if not exists included_in_total boolean not null default true;

alter table public.crm_opportunity_items
  drop constraint if exists crm_opportunity_items_item_kind_check;
alter table public.crm_opportunity_items
  add constraint crm_opportunity_items_item_kind_check
  check (item_kind in ('standard', 'optional', 'alternative'));

alter table public.crm_commercial_document_items
  drop constraint if exists crm_commercial_document_items_item_kind_check;
alter table public.crm_commercial_document_items
  add constraint crm_commercial_document_items_item_kind_check
  check (item_kind in ('standard', 'optional', 'alternative'));

create table if not exists public.crm_commercial_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.crm_commercial_documents(id) on delete cascade,
  version_number integer not null,
  snapshot jsonb not null,
  template_id uuid references public.order_templates(id) on delete set null,
  storage_path text not null,
  file_name text not null,
  pdf_sha256 text not null,
  pdf_size_bytes integer not null,
  created_by_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(document_id, version_number),
  unique(storage_path)
);

create table if not exists public.crm_commercial_document_deliveries (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.crm_commercial_documents(id) on delete cascade,
  version_id uuid references public.crm_commercial_document_versions(id) on delete set null,
  idempotency_key uuid not null unique,
  recipients jsonb not null default '[]'::jsonb,
  cc_recipients jsonb not null default '[]'::jsonb,
  subject text not null,
  message_html text not null,
  status text not null default 'pending',
  provider_message_id text,
  error_message text,
  custom_recipient_confirmed boolean not null default false,
  response_token_hash text,
  response_expires_at timestamptz,
  sent_by_member_id uuid references public.members(id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint crm_commercial_document_deliveries_status_check
    check (status in ('pending', 'sent', 'failed', 'accepted', 'rejected'))
);

create unique index if not exists uq_crm_delivery_response_token_hash
  on public.crm_commercial_document_deliveries(response_token_hash)
  where response_token_hash is not null;
create index if not exists idx_crm_document_deliveries_document_created
  on public.crm_commercial_document_deliveries(document_id, created_at desc);

create table if not exists public.crm_commercial_document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.crm_commercial_documents(id) on delete cascade,
  version_id uuid references public.crm_commercial_document_versions(id) on delete set null,
  delivery_id uuid references public.crm_commercial_document_deliveries(id) on delete set null,
  event_type text not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  actor_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_document_events_document_created
  on public.crm_commercial_document_events(document_id, created_at desc);

alter table public.crm_commercial_document_versions enable row level security;
alter table public.crm_commercial_document_deliveries enable row level security;
alter table public.crm_commercial_document_events enable row level security;

drop policy if exists "CRM document versions read access" on public.crm_commercial_document_versions;
create policy "CRM document versions read access" on public.crm_commercial_document_versions
  for select to authenticated using (
    public.get_user_role() = 'admin' or exists (
      select 1 from public.role_permissions p
      where p.role = public.get_user_role() and p.module = 'crm'
        and (p.can_read or p.can_edit or p.can_admin)
    )
  );

drop policy if exists "CRM document deliveries read access" on public.crm_commercial_document_deliveries;
create policy "CRM document deliveries read access" on public.crm_commercial_document_deliveries
  for select to authenticated using (
    public.get_user_role() = 'admin' or exists (
      select 1 from public.role_permissions p
      where p.role = public.get_user_role() and p.module = 'crm'
        and (p.can_read or p.can_edit or p.can_admin)
    )
  );

drop policy if exists "CRM document events read access" on public.crm_commercial_document_events;
create policy "CRM document events read access" on public.crm_commercial_document_events
  for select to authenticated using (
    public.get_user_role() = 'admin' or exists (
      select 1 from public.role_permissions p
      where p.role = public.get_user_role() and p.module = 'crm'
        and (p.can_read or p.can_edit or p.can_admin)
    )
  );

revoke all on public.crm_commercial_document_versions from anon;
revoke all on public.crm_commercial_document_deliveries from anon;
revoke all on public.crm_commercial_document_events from anon;
grant select on public.crm_commercial_document_versions to authenticated;
grant select on public.crm_commercial_document_deliveries to authenticated;
grant select on public.crm_commercial_document_events to authenticated;
grant all on public.crm_commercial_document_versions to service_role;
grant all on public.crm_commercial_document_deliveries to service_role;
grant all on public.crm_commercial_document_events to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crm-commercial-documents', 'crm-commercial-documents', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "CRM commercial PDF read access" on storage.objects;
create policy "CRM commercial PDF read access" on storage.objects
  for select to authenticated using (
    bucket_id = 'crm-commercial-documents' and (
      public.get_user_role() = 'admin' or exists (
        select 1 from public.role_permissions p
        where p.role = public.get_user_role() and p.module = 'crm'
          and (p.can_read or p.can_edit or p.can_admin)
      )
    )
  );

-- Preserve display configuration while the established financial functions
-- calculate excluded optional/alternative rows with an effective quantity of zero.
create or replace function public.replace_crm_opportunity_items(
  p_opportunity_id uuid, p_items jsonb, p_sync_documents boolean default true
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_financial_items jsonb;
  v_result jsonb;
  v_opportunity public.crm_opportunities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_crm() then raise exception 'CRM edit permission required'; end if;
  select * into v_opportunity from public.crm_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'CRM opportunity not found'; end if;
  if v_opportunity.deleted_at is not null or v_opportunity.archived_at is not null or v_opportunity.cancelled_at is not null then
    raise exception 'An inactive CRM opportunity cannot be edited';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Opportunity items must be an array';
  end if;
  select coalesce(jsonb_agg(
    case when coalesce((item ->> 'included_in_total')::boolean, true) then item
      else jsonb_set(item, '{quantity}', '0'::jsonb, true) end order by ordinal
  ), '[]'::jsonb)
  into v_financial_items
  from jsonb_array_elements(p_items) with ordinality source(item, ordinal);

  v_result := public.replace_crm_opportunity_items_financial_v1(
    p_opportunity_id, v_financial_items, p_sync_documents
  );

  with source as (
    select row_number() over () as row_number, item.*
    from jsonb_to_recordset(p_items) as item(
      quantity numeric, unit_price numeric, unit_cost numeric, purchase_price_snapshot numeric,
      sort_order integer, section_name text, item_kind text, alternative_group text,
      included_in_total boolean
    )
  ), normalized as (
    select coalesce(sort_order, row_number * 10)::integer as sort_order,
      coalesce(quantity, 0) as quantity, coalesce(unit_price, 0) as unit_price,
      coalesce(unit_cost, purchase_price_snapshot, 0) as unit_cost,
      nullif(btrim(section_name), '') as section_name,
      case when item_kind in ('standard', 'optional', 'alternative') then item_kind else 'standard' end as item_kind,
      nullif(btrim(alternative_group), '') as alternative_group,
      coalesce(included_in_total, true) as included_in_total
    from source
  )
  update public.crm_opportunity_items target
  set quantity = source.quantity, unit_price = source.unit_price, unit_cost = source.unit_cost,
      purchase_price_snapshot = source.unit_cost, section_name = source.section_name,
      item_kind = source.item_kind, alternative_group = source.alternative_group,
      included_in_total = source.included_in_total
  from normalized source
  where target.opportunity_id = p_opportunity_id and target.sort_order = source.sort_order;

  if p_sync_documents then
    with source as (
      select row_number() over () as row_number, item.*
      from jsonb_to_recordset(p_items) as item(
        quantity numeric, unit_price numeric, unit_cost numeric, purchase_price_snapshot numeric,
        sort_order integer, section_name text, item_kind text, alternative_group text,
        included_in_total boolean
      )
    ), normalized as (
      select coalesce(sort_order, row_number * 10)::integer as sort_order,
        coalesce(quantity, 0) as quantity, coalesce(unit_price, 0) as unit_price,
        coalesce(unit_cost, purchase_price_snapshot, 0) as unit_cost,
        nullif(btrim(section_name), '') as section_name,
        case when item_kind in ('standard', 'optional', 'alternative') then item_kind else 'standard' end as item_kind,
        nullif(btrim(alternative_group), '') as alternative_group,
        coalesce(included_in_total, true) as included_in_total
      from source
    )
    update public.crm_commercial_document_items target
    set quantity = source.quantity, unit_price = source.unit_price, unit_cost = source.unit_cost,
        purchase_price_snapshot = source.unit_cost, section_name = source.section_name,
        item_kind = source.item_kind, alternative_group = source.alternative_group,
        included_in_total = source.included_in_total
    from normalized source
    join public.crm_commercial_documents document
      on document.opportunity_id = p_opportunity_id and document.sync_items = true
      and document.status = 'draft' and document.deleted_at is null and document.archived_at is null
    where target.document_id = document.id and target.sort_order = source.sort_order;
  end if;

  return v_result;
end;
$$;

alter function public.replace_crm_document_items(uuid, jsonb)
  rename to replace_crm_document_items_financial_v1;
revoke all on function public.replace_crm_document_items_financial_v1(uuid, jsonb)
  from public, anon, authenticated;

create function public.replace_crm_document_items(p_document_id uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_financial_items jsonb;
  v_result jsonb;
  v_document public.crm_commercial_documents%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_crm() then raise exception 'CRM edit permission required'; end if;
  select * into v_document from public.crm_commercial_documents where id = p_document_id for update;
  if not found then raise exception 'CRM commercial document not found'; end if;
  if v_document.status <> 'draft' or v_document.deleted_at is not null or v_document.archived_at is not null or v_document.cancelled_at is not null then
    raise exception 'Only an active draft commercial document can be edited';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Document items must be an array';
  end if;
  select coalesce(jsonb_agg(
    case when coalesce((item ->> 'included_in_total')::boolean, true) then item
      else jsonb_set(item, '{quantity}', '0'::jsonb, true) end order by ordinal
  ), '[]'::jsonb)
  into v_financial_items
  from jsonb_array_elements(p_items) with ordinality source(item, ordinal);

  v_result := public.replace_crm_document_items_financial_v1(p_document_id, v_financial_items);

  with source as (
    select row_number() over () as row_number, item.*
    from jsonb_to_recordset(p_items) as item(
      quantity numeric, unit_price numeric, unit_cost numeric, purchase_price_snapshot numeric,
      sort_order integer, section_name text, item_kind text, alternative_group text,
      included_in_total boolean
    )
  ), normalized as (
    select coalesce(sort_order, row_number * 10)::integer as sort_order,
      coalesce(quantity, 0) as quantity, coalesce(unit_price, 0) as unit_price,
      coalesce(unit_cost, purchase_price_snapshot, 0) as unit_cost,
      nullif(btrim(section_name), '') as section_name,
      case when item_kind in ('standard', 'optional', 'alternative') then item_kind else 'standard' end as item_kind,
      nullif(btrim(alternative_group), '') as alternative_group,
      coalesce(included_in_total, true) as included_in_total
    from source
  )
  update public.crm_commercial_document_items target
  set quantity = source.quantity, unit_price = source.unit_price, unit_cost = source.unit_cost,
      purchase_price_snapshot = source.unit_cost, section_name = source.section_name,
      item_kind = source.item_kind, alternative_group = source.alternative_group,
      included_in_total = source.included_in_total
  from normalized source
  where target.document_id = p_document_id and target.sort_order = source.sort_order;

  return v_result;
end;
$$;
revoke all on function public.replace_crm_document_items(uuid, jsonb) from public, anon;
grant execute on function public.replace_crm_document_items(uuid, jsonb) to authenticated;

create or replace function public.accept_crm_offer(
  p_offer_id uuid,
  p_response_note text default null,
  p_external boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offer public.crm_commercial_documents%rowtype;
  v_order public.crm_commercial_documents%rowtype;
  v_setting public.crm_numbering_settings%rowtype;
  v_order_number text;
  v_year text;
begin
  if not (auth.role() = 'service_role' or (auth.uid() is not null and public.can_edit_crm())) then
    raise exception 'CRM edit permission required';
  end if;
  select * into v_offer from public.crm_commercial_documents
  where id = p_offer_id and type = 'offer' and deleted_at is null for update;
  if not found then raise exception 'Offer not found'; end if;
  if v_offer.status in ('rejected', 'cancelled') then raise exception 'Offer cannot be accepted'; end if;

  update public.crm_commercial_documents
  set status = 'accepted', accepted_at = coalesce(accepted_at, now()), responded_at = now(),
      response_note = nullif(btrim(p_response_note), ''), sync_items = false, updated_at = now()
  where id = v_offer.id returning * into v_offer;

  select * into v_order from public.crm_commercial_documents
  where source_document_id = v_offer.id and type = 'order' and deleted_at is null limit 1;
  if v_order.id is null then
    insert into public.crm_numbering_settings(document_type, prefix, next_number, padding, year_format)
    values ('order', 'OBJ', 1, 3, 'YY') on conflict(document_type) do nothing;
    select * into v_setting from public.crm_numbering_settings where document_type = 'order' for update;
    v_year := case coalesce(v_setting.year_format, 'YY') when 'NONE' then '' when 'YYYY' then to_char(current_date, 'YYYY') else to_char(current_date, 'YY') end;
    v_order_number := concat_ws('-', nullif(trim(v_setting.prefix), ''), nullif(v_year, ''), lpad(v_setting.next_number::text, greatest(v_setting.padding, 2), '0'));
    update public.crm_numbering_settings set next_number = v_setting.next_number + 1, updated_at = now() where document_type = 'order';

    insert into public.crm_commercial_documents(
      opportunity_id, subject_id, type, status, number, title, issue_date, valid_until,
      currency, gross_subtotal, subtotal, discount_total, tax_total, total, total_with_tax,
      cost_total, total_cost, margin_total, margin_value, margin_percent, commission_total,
      profit_after_commission, profit_after_commission_percent, notes, metadata, sync_items,
      source_document_id
    ) values (
      v_offer.opportunity_id, v_offer.subject_id, 'order', 'draft', v_order_number,
      regexp_replace(v_offer.title, '^Nabídka', 'Objednávka', 'i'), current_date, null,
      v_offer.currency, v_offer.gross_subtotal, v_offer.subtotal, v_offer.discount_total,
      v_offer.tax_total, v_offer.total, v_offer.total_with_tax, v_offer.cost_total,
      v_offer.total_cost, v_offer.margin_total, v_offer.margin_value, v_offer.margin_percent,
      v_offer.commission_total, v_offer.profit_after_commission,
      v_offer.profit_after_commission_percent, v_offer.notes,
      coalesce(v_offer.metadata, '{}'::jsonb) || jsonb_build_object('accepted_offer_id', v_offer.id, 'external_acceptance', p_external),
      false, v_offer.id
    ) returning * into v_order;

    insert into public.crm_commercial_document_items(
      document_id, catalog_item_id, code, name, description, quantity, unit, unit_price,
      unit_cost, purchase_price_snapshot, discount_percent, vat_rate, commission_percent,
      line_total, margin_total, margin_percent, commission_total, profit_after_commission,
      profit_after_commission_percent, sort_order, product_sku, product_type,
      stock_available_snapshot, catalog_price_snapshot, supplier_offer_id, supplier_name,
      supplier_sku_snapshot, section_name, item_kind, alternative_group, included_in_total
    )
    select v_order.id, catalog_item_id, code, name, description, quantity, unit, unit_price,
      unit_cost, purchase_price_snapshot, discount_percent, vat_rate, commission_percent,
      line_total, margin_total, margin_percent, commission_total, profit_after_commission,
      profit_after_commission_percent, sort_order, product_sku, product_type,
      stock_available_snapshot, catalog_price_snapshot, supplier_offer_id, supplier_name,
      supplier_sku_snapshot, section_name, item_kind, alternative_group, included_in_total
    from public.crm_commercial_document_items where document_id = v_offer.id order by sort_order, id;
  end if;

  update public.crm_opportunities
  set stage = 'won', status = 'won', probability = 100, updated_at = now()
  where id = v_offer.opportunity_id;

  insert into public.crm_commercial_document_events(document_id, event_type, summary, metadata)
  values (v_offer.id, 'accepted', 'Nabídka byla přijata', jsonb_build_object('external', p_external, 'order_id', v_order.id));

  return jsonb_build_object('offer', to_jsonb(v_offer), 'order', to_jsonb(v_order));
end;
$$;
revoke all on function public.accept_crm_offer(uuid, text, boolean) from public, anon;
grant execute on function public.accept_crm_offer(uuid, text, boolean) to authenticated, service_role;

commit;
