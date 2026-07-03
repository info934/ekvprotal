-- Add CRM item financial snapshots and keep current synchronized replace RPCs compatible.

alter table public.crm_opportunity_items
  add column if not exists unit_cost numeric(14, 2) default 0 not null,
  add column if not exists purchase_price_snapshot numeric(14, 2) default 0 not null,
  add column if not exists margin_total numeric(14, 2) default 0 not null,
  add column if not exists margin_percent numeric(8, 2) default 0 not null;

alter table public.crm_commercial_document_items
  add column if not exists unit_cost numeric(14, 2) default 0 not null,
  add column if not exists purchase_price_snapshot numeric(14, 2) default 0 not null,
  add column if not exists margin_total numeric(14, 2) default 0 not null,
  add column if not exists margin_percent numeric(8, 2) default 0 not null;

create or replace function public.crm_item_line_total(item jsonb)
returns numeric
language sql
immutable
as $$
  select round(
    (
      coalesce(nullif(item->>'quantity', '')::numeric, 0)
      * coalesce(nullif(item->>'unit_price', '')::numeric, 0)
      * (1 - least(100, greatest(0, coalesce(nullif(item->>'discount_percent', '')::numeric, 0))) / 100)
    )::numeric,
    2
  );
$$;

create or replace function public.replace_crm_opportunity_items(
  p_opportunity_id uuid,
  p_items jsonb,
  p_sync_documents boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric(14, 2) := 0;
  v_discount_total numeric(14, 2) := 0;
  v_total numeric(14, 2) := 0;
  v_tax_total numeric(14, 2) := 0;
  v_document_ids uuid[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_edit_crm() then
    raise exception 'CRM edit permission required';
  end if;

  if not exists (select 1 from public.crm_opportunities where id = p_opportunity_id) then
    raise exception 'CRM opportunity % not found', p_opportunity_id;
  end if;

  drop table if exists pg_temp.crm_rpc_items;
  create temp table crm_rpc_items on commit drop as
  select
    row_number() over () as row_number,
    nullif(item.catalog_item_id, '00000000-0000-0000-0000-000000000000'::uuid) as catalog_item_id,
    nullif(btrim(item.code), '') as code,
    coalesce(nullif(btrim(item.name), ''), 'Položka') as name,
    nullif(btrim(item.description), '') as description,
    coalesce(item.quantity, 0)::numeric as quantity,
    coalesce(nullif(btrim(item.unit), ''), 'ks') as unit,
    coalesce(item.unit_price, 0)::numeric as unit_price,
    coalesce(item.unit_cost, item.purchase_price_snapshot, 0)::numeric as unit_cost,
    least(100, greatest(0, coalesce(item.discount_percent, 0)))::numeric as discount_percent,
    coalesce(item.vat_rate, 21)::numeric as vat_rate,
    nullif(btrim(item.product_sku), '') as product_sku,
    nullif(btrim(item.product_type), '') as product_type,
    item.stock_available_snapshot::numeric as stock_available_snapshot,
    item.catalog_price_snapshot::numeric as catalog_price_snapshot,
    coalesce(item.sort_order, row_number() over () * 10)::integer as sort_order
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    catalog_item_id uuid,
    code text,
    name text,
    description text,
    quantity numeric,
    unit text,
    unit_price numeric,
    unit_cost numeric,
    purchase_price_snapshot numeric,
    discount_percent numeric,
    vat_rate numeric,
    product_sku text,
    product_type text,
    stock_available_snapshot numeric,
    catalog_price_snapshot numeric,
    sort_order integer
  );

  delete from public.crm_opportunity_items
  where opportunity_id = p_opportunity_id;

  insert into public.crm_opportunity_items (
    opportunity_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, unit_cost, purchase_price_snapshot, discount_percent, vat_rate,
    line_total, margin_total, margin_percent, sort_order,
    product_sku, product_type, stock_available_snapshot, catalog_price_snapshot
  )
  select
    p_opportunity_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, unit_cost, unit_cost, discount_percent, vat_rate,
    round(quantity * unit_price * (1 - (discount_percent / 100)), 2),
    round((quantity * unit_price * (1 - (discount_percent / 100))) - (quantity * unit_cost), 2),
    case when round(quantity * unit_price * (1 - (discount_percent / 100)), 2) > 0
      then round(((round(quantity * unit_price * (1 - (discount_percent / 100)), 2) - (quantity * unit_cost)) / round(quantity * unit_price * (1 - (discount_percent / 100)), 2) * 100)::numeric, 2)
      else 0 end,
    sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot
  from crm_rpc_items
  order by sort_order, row_number;

  select
    coalesce(sum(round(quantity * unit_price, 2)), 0),
    coalesce(sum(round(quantity * unit_price, 2) - round(quantity * unit_price * (1 - (discount_percent / 100)), 2)), 0),
    coalesce(sum(round(quantity * unit_price * (1 - (discount_percent / 100)), 2)), 0),
    coalesce(sum(round(quantity * unit_price * (1 - (discount_percent / 100)), 2) * (vat_rate / 100)), 0)
  into v_subtotal, v_discount_total, v_total, v_tax_total
  from crm_rpc_items;

  v_subtotal := round(v_subtotal, 2);
  v_discount_total := round(v_discount_total, 2);
  v_total := round(v_total, 2);
  v_tax_total := round(v_tax_total, 2);

  update public.crm_opportunities
  set value = v_total,
      updated_at = now()
  where id = p_opportunity_id;

  if p_sync_documents then
    select coalesce(array_agg(id), '{}')
    into v_document_ids
    from public.crm_commercial_documents
    where opportunity_id = p_opportunity_id
      and coalesce(sync_items, true) = true;

    delete from public.crm_commercial_document_items
    where document_id = any(v_document_ids);

    insert into public.crm_commercial_document_items (
      document_id, catalog_item_id, code, name, description, quantity, unit,
      unit_price, unit_cost, purchase_price_snapshot, discount_percent, vat_rate,
      line_total, margin_total, margin_percent, sort_order,
      product_sku, product_type, stock_available_snapshot, catalog_price_snapshot
    )
    select
      document_id, item.catalog_item_id, item.code, item.name, item.description,
      item.quantity, item.unit, item.unit_price, item.unit_cost, item.unit_cost,
      item.discount_percent, item.vat_rate,
      round(item.quantity * item.unit_price * (1 - (item.discount_percent / 100)), 2),
      round((item.quantity * item.unit_price * (1 - (item.discount_percent / 100))) - (item.quantity * item.unit_cost), 2),
      case when round(item.quantity * item.unit_price * (1 - (item.discount_percent / 100)), 2) > 0
        then round(((round(item.quantity * item.unit_price * (1 - (item.discount_percent / 100)), 2) - (item.quantity * item.unit_cost)) / round(item.quantity * item.unit_price * (1 - (item.discount_percent / 100)), 2) * 100)::numeric, 2)
        else 0 end,
      item.sort_order, item.product_sku, item.product_type,
      item.stock_available_snapshot, item.catalog_price_snapshot
    from unnest(v_document_ids) as document_id
    cross join crm_rpc_items item
    order by document_id, item.sort_order, item.row_number;

    update public.crm_commercial_documents
    set subtotal = v_subtotal,
        discount_total = v_discount_total,
        tax_total = v_tax_total,
        total = v_total,
        updated_at = now()
    where id = any(v_document_ids);
  end if;

  return jsonb_build_object(
    'opportunity_id', p_opportunity_id,
    'item_count', (select count(*) from crm_rpc_items),
    'document_count', coalesce(array_length(v_document_ids, 1), 0),
    'subtotal', v_subtotal,
    'discount_total', v_discount_total,
    'tax_total', v_tax_total,
    'total', v_total
  );
end;
$$;

create or replace function public.replace_crm_document_items(
  p_document_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subtotal numeric(14, 2) := 0;
  v_discount_total numeric(14, 2) := 0;
  v_total numeric(14, 2) := 0;
  v_tax_total numeric(14, 2) := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not public.can_edit_crm() then
    raise exception 'CRM edit permission required';
  end if;

  if not exists (select 1 from public.crm_commercial_documents where id = p_document_id) then
    raise exception 'CRM commercial document % not found', p_document_id;
  end if;

  drop table if exists pg_temp.crm_rpc_items;
  create temp table crm_rpc_items on commit drop as
  select
    row_number() over () as row_number,
    nullif(item.catalog_item_id, '00000000-0000-0000-0000-000000000000'::uuid) as catalog_item_id,
    nullif(btrim(item.code), '') as code,
    coalesce(nullif(btrim(item.name), ''), 'Položka') as name,
    nullif(btrim(item.description), '') as description,
    coalesce(item.quantity, 0)::numeric as quantity,
    coalesce(nullif(btrim(item.unit), ''), 'ks') as unit,
    coalesce(item.unit_price, 0)::numeric as unit_price,
    coalesce(item.unit_cost, item.purchase_price_snapshot, 0)::numeric as unit_cost,
    least(100, greatest(0, coalesce(item.discount_percent, 0)))::numeric as discount_percent,
    coalesce(item.vat_rate, 21)::numeric as vat_rate,
    nullif(btrim(item.product_sku), '') as product_sku,
    nullif(btrim(item.product_type), '') as product_type,
    item.stock_available_snapshot::numeric as stock_available_snapshot,
    item.catalog_price_snapshot::numeric as catalog_price_snapshot,
    coalesce(item.sort_order, row_number() over () * 10)::integer as sort_order
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    catalog_item_id uuid,
    code text,
    name text,
    description text,
    quantity numeric,
    unit text,
    unit_price numeric,
    unit_cost numeric,
    purchase_price_snapshot numeric,
    discount_percent numeric,
    vat_rate numeric,
    product_sku text,
    product_type text,
    stock_available_snapshot numeric,
    catalog_price_snapshot numeric,
    sort_order integer
  );

  delete from public.crm_commercial_document_items
  where document_id = p_document_id;

  insert into public.crm_commercial_document_items (
    document_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, unit_cost, purchase_price_snapshot, discount_percent, vat_rate,
    line_total, margin_total, margin_percent, sort_order,
    product_sku, product_type, stock_available_snapshot, catalog_price_snapshot
  )
  select
    p_document_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, unit_cost, unit_cost, discount_percent, vat_rate,
    round(quantity * unit_price * (1 - (discount_percent / 100)), 2),
    round((quantity * unit_price * (1 - (discount_percent / 100))) - (quantity * unit_cost), 2),
    case when round(quantity * unit_price * (1 - (discount_percent / 100)), 2) > 0
      then round(((round(quantity * unit_price * (1 - (discount_percent / 100)), 2) - (quantity * unit_cost)) / round(quantity * unit_price * (1 - (discount_percent / 100)), 2) * 100)::numeric, 2)
      else 0 end,
    sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot
  from crm_rpc_items
  order by sort_order, row_number;

  select
    coalesce(sum(round(quantity * unit_price, 2)), 0),
    coalesce(sum(round(quantity * unit_price, 2) - round(quantity * unit_price * (1 - (discount_percent / 100)), 2)), 0),
    coalesce(sum(round(quantity * unit_price * (1 - (discount_percent / 100)), 2)), 0),
    coalesce(sum(round(quantity * unit_price * (1 - (discount_percent / 100)), 2) * (vat_rate / 100)), 0)
  into v_subtotal, v_discount_total, v_total, v_tax_total
  from crm_rpc_items;

  v_subtotal := round(v_subtotal, 2);
  v_discount_total := round(v_discount_total, 2);
  v_total := round(v_total, 2);
  v_tax_total := round(v_tax_total, 2);

  update public.crm_commercial_documents
  set subtotal = v_subtotal,
      discount_total = v_discount_total,
      tax_total = v_tax_total,
      total = v_total,
      updated_at = now()
  where id = p_document_id;

  return jsonb_build_object(
    'document_id', p_document_id,
    'item_count', (select count(*) from crm_rpc_items),
    'subtotal', v_subtotal,
    'discount_total', v_discount_total,
    'tax_total', v_tax_total,
    'total', v_total
  );
end;
$$;

revoke execute on function public.replace_crm_opportunity_items(uuid, jsonb, boolean) from public, anon;
revoke execute on function public.replace_crm_document_items(uuid, jsonb) from public, anon;
grant execute on function public.replace_crm_opportunity_items(uuid, jsonb, boolean) to authenticated;
grant execute on function public.replace_crm_document_items(uuid, jsonb) to authenticated;