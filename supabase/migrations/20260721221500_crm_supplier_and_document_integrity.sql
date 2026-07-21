create or replace function public.refresh_product_preferred_supplier(p_catalog_item_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  best_offer record;
  catalog_currency text;
begin
  select upper(coalesce(currency, 'CZK')) into catalog_currency
  from public.commercial_item_catalog where id = p_catalog_item_id;

  select offer.id, offer.last_price_without_vat, supplier.name as supplier_name, offer.supplier_sku
  into best_offer
  from public.product_supplier_offers offer
  join public.product_suppliers supplier on supplier.id = offer.supplier_id
  where offer.catalog_item_id = p_catalog_item_id
    and offer.is_active and supplier.is_active
    and offer.last_price_without_vat is not null
    and upper(coalesce(offer.currency, 'CZK')) = catalog_currency
  order by offer.last_price_without_vat, offer.last_seen_at desc nulls last
  limit 1;

  if best_offer.id is null then
    update public.commercial_item_catalog
    set preferred_supplier_offer_id = null,
        metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{supplier_price_status}', '"missing_current_price"'::jsonb, true)
    where id = p_catalog_item_id;
    return;
  end if;

  update public.commercial_item_catalog
  set preferred_supplier_offer_id = best_offer.id,
      purchase_price = best_offer.last_price_without_vat,
      default_unit_price = case when best_offer.last_price_without_vat > 0 then round(best_offer.last_price_without_vat / 0.8, 2) else default_unit_price end,
      metadata = jsonb_set(jsonb_set(jsonb_set(jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{preferred_supplier}', to_jsonb(best_offer.supplier_name), true),
        '{preferred_supplier_sku}', to_jsonb(best_offer.supplier_sku), true),
        '{supplier_price_status}', '"current_price_available"'::jsonb, true),
        '{default_margin_percent}', '20'::jsonb, true)
  where id = p_catalog_item_id;
end;
$$;

create or replace function public.sync_product_supplier_offer_from_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare target_catalog_id uuid;
begin
  update public.product_supplier_offers
  set last_seen_at = new.scraped_at,
      last_price_without_vat = new.price_without_vat,
      last_price_raw = new.price_raw,
      availability_note = coalesce(new.availability_note, availability_note),
      currency = coalesce(new.currency, currency),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_snapshot_id', new.id)
  where id = new.supplier_offer_id
    and (last_seen_at is null or new.scraped_at >= last_seen_at)
  returning catalog_item_id into target_catalog_id;

  if target_catalog_id is null then
    select catalog_item_id into target_catalog_id from public.product_supplier_offers where id = new.supplier_offer_id;
  end if;
  if target_catalog_id is not null then perform public.refresh_product_preferred_supplier(target_catalog_id); end if;
  return new;
end;
$$;

update public.crm_commercial_documents
set sync_items = false
where sync_items = true and (status <> 'draft' or deleted_at is not null or archived_at is not null);

create or replace function public.enforce_crm_document_lifecycle()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'draft' or new.deleted_at is not null or new.archived_at is not null then new.sync_items := false; end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_crm_document_lifecycle on public.crm_commercial_documents;
create trigger trg_enforce_crm_document_lifecycle
before insert or update on public.crm_commercial_documents
for each row execute function public.enforce_crm_document_lifecycle();

create or replace function public.guard_crm_document_item_mutation()
returns trigger language plpgsql set search_path = public as $$
declare
  target_document_id uuid := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
  target_document public.crm_commercial_documents%rowtype;
begin
  select * into target_document from public.crm_commercial_documents where id = target_document_id for update;
  if not found then raise exception 'Commercial document not found'; end if;
  if target_document.status <> 'draft' or target_document.deleted_at is not null or target_document.archived_at is not null then
    raise exception 'Items of a finalized commercial document cannot be changed';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_crm_document_item_mutation on public.crm_commercial_document_items;
create trigger trg_guard_crm_document_item_mutation
before insert or update or delete on public.crm_commercial_document_items
for each row execute function public.guard_crm_document_item_mutation();

create or replace function public.save_crm_commercial_document_draft(
  p_document_id uuid,
  p_document jsonb,
  p_items jsonb,
  p_sync_items boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document public.crm_commercial_documents%rowtype;
  v_next_status text := coalesce(nullif(p_document ->> 'status', ''), 'draft');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_crm() then raise exception 'CRM edit permission required'; end if;

  select * into v_document
  from public.crm_commercial_documents
  where id = p_document_id
  for update;
  if not found then raise exception 'Commercial document not found'; end if;
  if v_document.status <> 'draft' or v_document.deleted_at is not null or v_document.archived_at is not null then
    raise exception 'Only a draft commercial document can be saved';
  end if;

  if p_sync_items then
    perform public.replace_crm_opportunity_items(v_document.opportunity_id, coalesce(p_items, '[]'::jsonb), true);
  else
    perform public.replace_crm_document_items(p_document_id, coalesce(p_items, '[]'::jsonb));
  end if;

  update public.crm_commercial_documents
  set title = coalesce(nullif(btrim(p_document ->> 'title'), ''), title),
      status = v_next_status,
      issue_date = coalesce(nullif(p_document ->> 'issue_date', '')::date, issue_date),
      valid_until = nullif(p_document ->> 'valid_until', '')::date,
      notes = nullif(p_document ->> 'notes', ''),
      subject_id = nullif(p_document ->> 'subject_id', '')::uuid,
      sync_items = case when v_next_status = 'draft' then p_sync_items else false end,
      updated_at = now()
  where id = p_document_id
  returning * into v_document;

  return to_jsonb(v_document);
end;
$$;

revoke all on function public.save_crm_commercial_document_draft(uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.save_crm_commercial_document_draft(uuid, jsonb, jsonb, boolean) to authenticated;
