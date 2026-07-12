-- Targeted type-safety fixes discovered by the production database lint.
-- TEMP table references in CRM RPCs are intentional and transaction-local.

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
  v_gross_subtotal numeric(14, 2) := 0;
  v_discount_total numeric(14, 2) := 0;
  v_total numeric(14, 2) := 0;
  v_tax_total numeric(14, 2) := 0;
  v_cost_total numeric(14, 2) := 0;
  v_margin_total numeric(14, 2) := 0;
  v_commission_total numeric(14, 2) := 0;
  v_profit_after_commission numeric(14, 2) := 0;
  v_document_ids uuid[] := ARRAY[]::uuid[];
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
  with raw_items as (
    select
      row_number() over () as row_number,
      item.*
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
      commission_percent numeric,
      product_sku text,
      product_type text,
      stock_available_snapshot numeric,
      catalog_price_snapshot numeric,
      supplier_offer_id uuid,
      supplier_name text,
      supplier_sku_snapshot text,
      sort_order integer
    )
  ), normalized as (
    select
      row_number,
      nullif(catalog_item_id, '00000000-0000-0000-0000-000000000000'::uuid) as catalog_item_id,
      nullif(btrim(code), '') as code,
      coalesce(nullif(btrim(name), ''), 'Položka') as name,
      nullif(btrim(description), '') as description,
      coalesce(quantity, 0)::numeric as quantity,
      coalesce(nullif(btrim(unit), ''), 'ks') as unit,
      coalesce(unit_price, 0)::numeric as unit_price,
      coalesce(unit_cost, purchase_price_snapshot, 0)::numeric as unit_cost,
      least(100, greatest(0, coalesce(discount_percent, 0)))::numeric as discount_percent,
      public.normalize_crm_vat_rate(vat_rate)::numeric as vat_rate,
      least(100, greatest(0, coalesce(commission_percent, 0)))::numeric as commission_percent,
      nullif(btrim(product_sku), '') as product_sku,
      nullif(btrim(product_type), '') as product_type,
      stock_available_snapshot::numeric as stock_available_snapshot,
      catalog_price_snapshot::numeric as catalog_price_snapshot,
      supplier_offer_id,
      nullif(btrim(supplier_name), '') as supplier_name,
      nullif(btrim(supplier_sku_snapshot), '') as supplier_sku_snapshot,
      coalesce(sort_order, row_number * 10)::integer as sort_order
    from raw_items
  )
  select
    *,
    round(quantity * unit_price, 2) as gross_subtotal,
    round(quantity * unit_price * (discount_percent / 100), 2) as discount_total,
    round(quantity * unit_price * (1 - (discount_percent / 100)), 2) as line_total,
    round(quantity * unit_price * (1 - (discount_percent / 100)) * (vat_rate / 100), 2) as tax_total,
    round(quantity * unit_cost, 2) as cost_total,
    round((quantity * unit_price * (1 - (discount_percent / 100))) - (quantity * unit_cost), 2) as margin_total,
    round(quantity * unit_price * (1 - (discount_percent / 100)) * (commission_percent / 100), 2) as commission_total
  from normalized;

  delete from public.crm_opportunity_items
  where opportunity_id = p_opportunity_id;

  insert into public.crm_opportunity_items (
    opportunity_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, unit_cost, purchase_price_snapshot, discount_percent, vat_rate,
    commission_percent, line_total, margin_total, margin_percent, commission_total,
    profit_after_commission, profit_after_commission_percent, sort_order,
    product_sku, product_type, stock_available_snapshot, catalog_price_snapshot,
    supplier_offer_id, supplier_name, supplier_sku_snapshot
  )
  select
    p_opportunity_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, unit_cost, unit_cost, discount_percent, vat_rate,
    commission_percent, line_total, margin_total,
    case when line_total > 0 then round((margin_total / line_total * 100)::numeric, 2) else 0 end,
    commission_total,
    round(margin_total - commission_total, 2),
    case when line_total > 0 then round(((margin_total - commission_total) / line_total * 100)::numeric, 2) else 0 end,
    sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot,
    supplier_offer_id, supplier_name, supplier_sku_snapshot
  from crm_rpc_items
  order by sort_order, row_number;

  select
    coalesce(sum(gross_subtotal), 0),
    coalesce(sum(discount_total), 0),
    coalesce(sum(line_total), 0),
    coalesce(sum(tax_total), 0),
    coalesce(sum(cost_total), 0),
    coalesce(sum(margin_total), 0),
    coalesce(sum(commission_total), 0),
    coalesce(sum(round(margin_total - commission_total, 2)), 0)
  into v_gross_subtotal, v_discount_total, v_total, v_tax_total, v_cost_total, v_margin_total, v_commission_total, v_profit_after_commission
  from crm_rpc_items;

  update public.crm_opportunities
  set value = round(v_total, 2),
      updated_at = now()
  where id = p_opportunity_id;

  if p_sync_documents then
    select coalesce(array_agg(id), ARRAY[]::uuid[])
    into v_document_ids
    from public.crm_commercial_documents
    where opportunity_id = p_opportunity_id
      and coalesce(sync_items, true) = true;

    delete from public.crm_commercial_document_items
    where document_id = any(v_document_ids);

    insert into public.crm_commercial_document_items (
      document_id, catalog_item_id, code, name, description, quantity, unit,
      unit_price, unit_cost, purchase_price_snapshot, discount_percent, vat_rate,
      commission_percent, line_total, margin_total, margin_percent, commission_total,
      profit_after_commission, profit_after_commission_percent, sort_order,
      product_sku, product_type, stock_available_snapshot, catalog_price_snapshot,
      supplier_offer_id, supplier_name, supplier_sku_snapshot
    )
    select
      document_id, item.catalog_item_id, item.code, item.name, item.description,
      item.quantity, item.unit, item.unit_price, item.unit_cost, item.unit_cost,
      item.discount_percent, item.vat_rate, item.commission_percent, item.line_total,
      item.margin_total,
      case when item.line_total > 0 then round((item.margin_total / item.line_total * 100)::numeric, 2) else 0 end,
      item.commission_total,
      round(item.margin_total - item.commission_total, 2),
      case when item.line_total > 0 then round(((item.margin_total - item.commission_total) / item.line_total * 100)::numeric, 2) else 0 end,
      item.sort_order, item.product_sku, item.product_type,
      item.stock_available_snapshot, item.catalog_price_snapshot,
      item.supplier_offer_id, item.supplier_name, item.supplier_sku_snapshot
    from unnest(v_document_ids) as document_id
    cross join crm_rpc_items item
    order by document_id, item.sort_order, item.row_number;

    update public.crm_commercial_documents
    set gross_subtotal = round(v_gross_subtotal, 2),
        subtotal = round(v_gross_subtotal, 2),
        discount_total = round(v_discount_total, 2),
        tax_total = round(v_tax_total, 2),
        total = round(v_total, 2),
        total_with_tax = round(v_total + v_tax_total, 2),
        cost_total = round(v_cost_total, 2),
        total_cost = round(v_cost_total, 2),
        margin_total = round(v_margin_total, 2),
        margin_value = round(v_margin_total, 2),
        margin_percent = case when v_total > 0 then round((v_margin_total / v_total * 100)::numeric, 2) else 0 end,
        commission_total = round(v_commission_total, 2),
        profit_after_commission = round(v_profit_after_commission, 2),
        profit_after_commission_percent = case when v_total > 0 then round((v_profit_after_commission / v_total * 100)::numeric, 2) else 0 end,
        updated_at = now()
    where id = any(v_document_ids);
  end if;

  return jsonb_build_object(
    'opportunity_id', p_opportunity_id,
    'item_count', (select count(*) from crm_rpc_items),
    'document_count', coalesce(array_length(v_document_ids, 1), 0),
    'gross_subtotal', round(v_gross_subtotal, 2),
    'discount_total', round(v_discount_total, 2),
    'tax_total', round(v_tax_total, 2),
    'total', round(v_total, 2),
    'total_with_tax', round(v_total + v_tax_total, 2),
    'cost_total', round(v_cost_total, 2),
    'margin_total', round(v_margin_total, 2),
    'commission_total', round(v_commission_total, 2),
    'profit_after_commission', round(v_profit_after_commission, 2)
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
  v_gross_subtotal numeric(14, 2) := 0;
  v_discount_total numeric(14, 2) := 0;
  v_total numeric(14, 2) := 0;
  v_tax_total numeric(14, 2) := 0;
  v_cost_total numeric(14, 2) := 0;
  v_margin_total numeric(14, 2) := 0;
  v_commission_total numeric(14, 2) := 0;
  v_profit_after_commission numeric(14, 2) := 0;
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
  with raw_items as (
    select
      row_number() over () as row_number,
      item.*
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
      commission_percent numeric,
      product_sku text,
      product_type text,
      stock_available_snapshot numeric,
      catalog_price_snapshot numeric,
      supplier_offer_id uuid,
      supplier_name text,
      supplier_sku_snapshot text,
      sort_order integer
    )
  ), normalized as (
    select
      row_number,
      nullif(catalog_item_id, '00000000-0000-0000-0000-000000000000'::uuid) as catalog_item_id,
      nullif(btrim(code), '') as code,
      coalesce(nullif(btrim(name), ''), 'Položka') as name,
      nullif(btrim(description), '') as description,
      coalesce(quantity, 0)::numeric as quantity,
      coalesce(nullif(btrim(unit), ''), 'ks') as unit,
      coalesce(unit_price, 0)::numeric as unit_price,
      coalesce(unit_cost, purchase_price_snapshot, 0)::numeric as unit_cost,
      least(100, greatest(0, coalesce(discount_percent, 0)))::numeric as discount_percent,
      public.normalize_crm_vat_rate(vat_rate)::numeric as vat_rate,
      least(100, greatest(0, coalesce(commission_percent, 0)))::numeric as commission_percent,
      nullif(btrim(product_sku), '') as product_sku,
      nullif(btrim(product_type), '') as product_type,
      stock_available_snapshot::numeric as stock_available_snapshot,
      catalog_price_snapshot::numeric as catalog_price_snapshot,
      supplier_offer_id,
      nullif(btrim(supplier_name), '') as supplier_name,
      nullif(btrim(supplier_sku_snapshot), '') as supplier_sku_snapshot,
      coalesce(sort_order, row_number * 10)::integer as sort_order
    from raw_items
  )
  select
    *,
    round(quantity * unit_price, 2) as gross_subtotal,
    round(quantity * unit_price * (discount_percent / 100), 2) as discount_total,
    round(quantity * unit_price * (1 - (discount_percent / 100)), 2) as line_total,
    round(quantity * unit_price * (1 - (discount_percent / 100)) * (vat_rate / 100), 2) as tax_total,
    round(quantity * unit_cost, 2) as cost_total,
    round((quantity * unit_price * (1 - (discount_percent / 100))) - (quantity * unit_cost), 2) as margin_total,
    round(quantity * unit_price * (1 - (discount_percent / 100)) * (commission_percent / 100), 2) as commission_total
  from normalized;

  delete from public.crm_commercial_document_items
  where document_id = p_document_id;

  insert into public.crm_commercial_document_items (
    document_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, unit_cost, purchase_price_snapshot, discount_percent, vat_rate,
    commission_percent, line_total, margin_total, margin_percent, commission_total,
    profit_after_commission, profit_after_commission_percent, sort_order,
    product_sku, product_type, stock_available_snapshot, catalog_price_snapshot,
    supplier_offer_id, supplier_name, supplier_sku_snapshot
  )
  select
    p_document_id, catalog_item_id, code, name, description, quantity, unit,
    unit_price, unit_cost, unit_cost, discount_percent, vat_rate,
    commission_percent, line_total, margin_total,
    case when line_total > 0 then round((margin_total / line_total * 100)::numeric, 2) else 0 end,
    commission_total,
    round(margin_total - commission_total, 2),
    case when line_total > 0 then round(((margin_total - commission_total) / line_total * 100)::numeric, 2) else 0 end,
    sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot,
    supplier_offer_id, supplier_name, supplier_sku_snapshot
  from crm_rpc_items
  order by sort_order, row_number;

  select
    coalesce(sum(gross_subtotal), 0),
    coalesce(sum(discount_total), 0),
    coalesce(sum(line_total), 0),
    coalesce(sum(tax_total), 0),
    coalesce(sum(cost_total), 0),
    coalesce(sum(margin_total), 0),
    coalesce(sum(commission_total), 0),
    coalesce(sum(round(margin_total - commission_total, 2)), 0)
  into v_gross_subtotal, v_discount_total, v_total, v_tax_total, v_cost_total, v_margin_total, v_commission_total, v_profit_after_commission
  from crm_rpc_items;

  update public.crm_commercial_documents
  set gross_subtotal = round(v_gross_subtotal, 2),
      subtotal = round(v_gross_subtotal, 2),
      discount_total = round(v_discount_total, 2),
      tax_total = round(v_tax_total, 2),
      total = round(v_total, 2),
      total_with_tax = round(v_total + v_tax_total, 2),
      cost_total = round(v_cost_total, 2),
      total_cost = round(v_cost_total, 2),
      margin_total = round(v_margin_total, 2),
      margin_value = round(v_margin_total, 2),
      margin_percent = case when v_total > 0 then round((v_margin_total / v_total * 100)::numeric, 2) else 0 end,
      commission_total = round(v_commission_total, 2),
      profit_after_commission = round(v_profit_after_commission, 2),
      profit_after_commission_percent = case when v_total > 0 then round((v_profit_after_commission / v_total * 100)::numeric, 2) else 0 end,
      updated_at = now()
  where id = p_document_id;

  return jsonb_build_object(
    'document_id', p_document_id,
    'item_count', (select count(*) from crm_rpc_items),
    'gross_subtotal', round(v_gross_subtotal, 2),
    'discount_total', round(v_discount_total, 2),
    'tax_total', round(v_tax_total, 2),
    'total', round(v_total, 2),
    'total_with_tax', round(v_total + v_tax_total, 2),
    'cost_total', round(v_cost_total, 2),
    'margin_total', round(v_margin_total, 2),
    'commission_total', round(v_commission_total, 2),
    'profit_after_commission', round(v_profit_after_commission, 2)
  );
end;
$$;

revoke execute on function public.replace_crm_opportunity_items(uuid, jsonb, boolean) from public, anon;
revoke execute on function public.replace_crm_document_items(uuid, jsonb) from public, anon;
grant execute on function public.replace_crm_opportunity_items(uuid, jsonb, boolean) to authenticated;
grant execute on function public.replace_crm_document_items(uuid, jsonb) to authenticated;

CREATE OR REPLACE FUNCTION public.set_overhead_allocation_status(
  p_allocation_id uuid,
  p_status text,
  p_notes text DEFAULT NULL,
  p_action text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_admin boolean;
  v_allocation public.overhead_monthly_allocations%rowtype;
BEGIN
  v_can_admin := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'finance'
        AND rp.can_admin = true
    );

  IF NOT v_can_admin THEN
    RAISE EXCEPTION 'Not allowed to change overhead allocation status';
  END IF;

  IF p_status NOT IN ('DRAFT', 'PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'Unsupported overhead allocation status %. Use dedicated approve/reopen functions for accounting transitions.', p_status;
  END IF;

  SELECT *
  INTO v_allocation
  FROM public.overhead_monthly_allocations
  WHERE id = p_allocation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Overhead allocation not found';
  END IF;

  IF v_allocation.status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved overhead allocation must be reopened before status changes';
  END IF;

  UPDATE public.overhead_monthly_allocations
  SET
    status = p_status::public.overhead_allocation_status,
    notes = p_notes,
    updated_by = auth.uid()
  WHERE id = p_allocation_id
  RETURNING * INTO v_allocation;

  INSERT INTO public.overhead_audit_logs (
    monthly_allocation_id,
    user_id,
    user_email,
    action,
    details
  )
  VALUES (
    p_allocation_id,
    auth.uid(),
    auth.jwt() ->> 'email',
    COALESCE(p_action, 'Změna stavu režijní alokace'),
    jsonb_build_object('newStatus', p_status, 'notes', p_notes)
  );

  RETURN to_jsonb(v_allocation);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_overhead_allocation_status(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_overhead_allocation_status(uuid, text, text, text) TO authenticated;
