create or replace function public.audit_product_catalog_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_details jsonb;
  v_old jsonb;
  v_new jsonb;
  v_set_name text;
  v_catalog_item_name text;
  v_changed_fields text[] := array[]::text[];
begin
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;

  if tg_table_name = 'commercial_item_catalog' then
    v_action := case tg_op
      when 'INSERT' then 'product_created'
      when 'UPDATE' then 'product_updated'
      when 'DELETE' then 'product_deleted'
      else 'product_changed'
    end;

    if tg_op = 'UPDATE' then
      select array_agg(key order by key)
      into v_changed_fields
      from jsonb_object_keys(v_new) key
      where key in (
        'sku', 'code', 'name', 'description', 'category', 'unit', 'product_type',
        'default_unit_price', 'default_vat_rate', 'purchase_price', 'currency',
        'stock_min_qty', 'warehouse_location', 'allow_backorder', 'valid_from',
        'valid_until', 'datasheet_external_web_url', 'datasheet_file_name',
        'datasheet_preview_image_url', 'image_url', 'preferred_supplier_offer_id',
        'is_active', 'archived_at', 'metadata'
      )
      and coalesce(v_old -> key, 'null'::jsonb) is distinct from coalesce(v_new -> key, 'null'::jsonb);
    end if;

    v_details := jsonb_build_object(
      'table', tg_table_name,
      'entity_type', 'product',
      'product_id', coalesce(new.id, old.id),
      'catalog_item_id', coalesce(new.id, old.id),
      'product_code', coalesce(new.code, old.code, new.sku, old.sku),
      'product_name', coalesce(new.name, old.name),
      'changed_fields', coalesce(to_jsonb(v_changed_fields), '[]'::jsonb),
      'old_row', v_old,
      'new_row', v_new
    );
  elsif tg_table_name = 'product_sets' then
    v_action := case tg_op
      when 'INSERT' then 'product_set_created'
      when 'UPDATE' then 'product_set_updated'
      when 'DELETE' then 'product_set_deleted'
      else 'product_set_changed'
    end;

    if tg_op = 'UPDATE' then
      select array_agg(key order by key)
      into v_changed_fields
      from jsonb_object_keys(v_new) key
      where key in ('code', 'name', 'description', 'category', 'is_active', 'metadata')
      and coalesce(v_old -> key, 'null'::jsonb) is distinct from coalesce(v_new -> key, 'null'::jsonb);
    end if;

    v_details := jsonb_build_object(
      'table', tg_table_name,
      'entity_type', 'product_set',
      'set_id', coalesce(new.id, old.id),
      'set_code', coalesce(new.code, old.code),
      'set_name', coalesce(new.name, old.name),
      'changed_fields', coalesce(to_jsonb(v_changed_fields), '[]'::jsonb),
      'old_row', v_old,
      'new_row', v_new
    );
  elsif tg_table_name = 'product_set_items' then
    v_action := case tg_op
      when 'INSERT' then 'product_set_item_added'
      when 'UPDATE' then 'product_set_item_updated'
      when 'DELETE' then 'product_set_item_removed'
      else 'product_set_item_changed'
    end;

    select name into v_set_name
    from public.product_sets
    where id = coalesce(new.set_id, old.set_id);

    select name into v_catalog_item_name
    from public.commercial_item_catalog
    where id = coalesce(new.catalog_item_id, old.catalog_item_id);

    if tg_op = 'UPDATE' then
      select array_agg(key order by key)
      into v_changed_fields
      from jsonb_object_keys(v_new) key
      where key in ('catalog_item_id', 'quantity', 'sort_order', 'note')
      and coalesce(v_old -> key, 'null'::jsonb) is distinct from coalesce(v_new -> key, 'null'::jsonb);
    end if;

    v_details := jsonb_build_object(
      'table', tg_table_name,
      'entity_type', 'product_set_item',
      'set_id', coalesce(new.set_id, old.set_id),
      'set_name', v_set_name,
      'set_item_id', coalesce(new.id, old.id),
      'catalog_item_id', coalesce(new.catalog_item_id, old.catalog_item_id),
      'product_id', coalesce(new.catalog_item_id, old.catalog_item_id),
      'product_name', v_catalog_item_name,
      'quantity_before', case when tg_op = 'INSERT' then null else old.quantity end,
      'quantity_after', case when tg_op = 'DELETE' then null else new.quantity end,
      'changed_fields', coalesce(to_jsonb(v_changed_fields), '[]'::jsonb),
      'old_row', v_old,
      'new_row', v_new
    );
  else
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform public.log_workflow_audit(v_action, v_details);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists tr_audit_commercial_item_catalog_products on public.commercial_item_catalog;
create trigger tr_audit_commercial_item_catalog_products
after insert or update or delete on public.commercial_item_catalog
for each row execute function public.audit_product_catalog_change();

drop trigger if exists tr_audit_product_sets on public.product_sets;
create trigger tr_audit_product_sets
after insert or update or delete on public.product_sets
for each row execute function public.audit_product_catalog_change();

drop trigger if exists tr_audit_product_set_items on public.product_set_items;
create trigger tr_audit_product_set_items
after insert or update or delete on public.product_set_items
for each row execute function public.audit_product_catalog_change();

revoke all on function public.audit_product_catalog_change() from public;
revoke all on function public.audit_product_catalog_change() from anon;
revoke all on function public.audit_product_catalog_change() from authenticated;