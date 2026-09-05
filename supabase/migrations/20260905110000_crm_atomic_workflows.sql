-- Requires the existing CRM financial snapshots, document integrity and numbering
-- migrations. Every RPC below is one transaction: errors roll back headers,
-- items, links and allocated numbers together. No client-side fallback is safe.

begin;

-- Serialize replacements before the DELETE, including an initially empty OP.
-- Keep the existing financial implementation, but make its old entry point
-- private so callers cannot bypass the parent-row lock.
alter function public.replace_crm_opportunity_items(uuid, jsonb, boolean)
  rename to replace_crm_opportunity_items_financial_v1;
revoke all on function public.replace_crm_opportunity_items_financial_v1(uuid, jsonb, boolean) from public, anon, authenticated;

create function public.replace_crm_opportunity_items(
  p_opportunity_id uuid, p_items jsonb, p_sync_documents boolean default true
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_opportunity public.crm_opportunities%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_crm() then raise exception 'CRM edit permission required'; end if;
  select * into v_opportunity from public.crm_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'CRM opportunity not found'; end if;
  if v_opportunity.deleted_at is not null or v_opportunity.archived_at is not null or v_opportunity.cancelled_at is not null then
    raise exception 'An inactive CRM opportunity cannot be edited';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Opportunity items must be an array'; end if;
  return public.replace_crm_opportunity_items_financial_v1(p_opportunity_id, p_items, p_sync_documents);
end;
$$;
revoke all on function public.replace_crm_opportunity_items(uuid, jsonb, boolean) from public, anon;
grant execute on function public.replace_crm_opportunity_items(uuid, jsonb, boolean) to authenticated;

create or replace function public.save_crm_commercial_document_draft(
  p_document_id uuid, p_document jsonb, p_items jsonb, p_sync_items boolean default true
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_document public.crm_commercial_documents%rowtype;
  v_opportunity_id uuid;
  v_next_status text := coalesce(nullif(p_document ->> 'status', ''), 'draft');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_crm() then raise exception 'CRM edit permission required'; end if;
  if p_sync_items is null then raise exception 'Item synchronization mode is required'; end if;
  select opportunity_id into v_opportunity_id from public.crm_commercial_documents where id = p_document_id;
  -- All compound workflows acquire the opportunity before the document.
  perform 1 from public.crm_opportunities where id = v_opportunity_id for update;
  select * into v_document from public.crm_commercial_documents where id = p_document_id for update;
  if not found then raise exception 'Commercial document not found'; end if;
  if v_document.opportunity_id <> v_opportunity_id then raise exception 'Document relation changed; reload and retry'; end if;
  if v_document.status <> 'draft' or v_document.deleted_at is not null or v_document.archived_at is not null or v_document.cancelled_at is not null then
    raise exception 'Only an active draft commercial document can be saved';
  end if;
  -- Include this draft in the same synchronization when switching from own
  -- items to OP items. Otherwise its persisted snapshot remains stale.
  update public.crm_commercial_documents set sync_items = p_sync_items where id = p_document_id;
  if p_sync_items then
    perform public.replace_crm_opportunity_items(v_document.opportunity_id, coalesce(p_items, '[]'::jsonb), true);
  else
    perform public.replace_crm_document_items(p_document_id, coalesce(p_items, '[]'::jsonb));
  end if;
  update public.crm_commercial_documents
  set title = coalesce(nullif(btrim(p_document ->> 'title'), ''), title), status = v_next_status,
      issue_date = coalesce(nullif(p_document ->> 'issue_date', '')::date, issue_date),
      valid_until = nullif(p_document ->> 'valid_until', '')::date, notes = nullif(p_document ->> 'notes', ''),
      subject_id = nullif(p_document ->> 'subject_id', '')::uuid,
      sync_items = v_next_status = 'draft' and p_sync_items, updated_at = now()
  where id = p_document_id returning * into v_document;
  return to_jsonb(v_document);
end;
$$;

create or replace function public.create_crm_commercial_document_atomic(
  p_opportunity_id uuid default null,
  p_type text default 'offer',
  p_new_opportunity jsonb default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opportunity public.crm_opportunities%rowtype;
  v_document public.crm_commercial_documents%rowtype;
  v_items jsonb;
  v_title text;
  v_value numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_crm() then raise exception 'CRM edit permission required'; end if;
  if exists (select 1 from public.user_account_status where auth_user_id = auth.uid() and status = 'disabled') then
    raise exception 'Account is disabled';
  end if;
  if p_type is null or p_type not in ('offer', 'order') then raise exception 'Invalid commercial document type'; end if;
  if p_opportunity_id is not null and p_new_opportunity is not null then
    raise exception 'Choose either an existing or a new opportunity';
  end if;

  if p_opportunity_id is null then
    v_title := nullif(btrim(p_new_opportunity ->> 'title'), '');
    v_value := coalesce(nullif(p_new_opportunity ->> 'value', '')::numeric, 0);
    if v_title is null or nullif(p_new_opportunity ->> 'subject_id', '') is null then
      raise exception 'New opportunity requires a title and a subject';
    end if;
    if v_value < 0 or v_value = 'NaN'::numeric then raise exception 'Invalid opportunity value'; end if;
    insert into public.crm_opportunities (number, title, subject_id, stage, status, priority, value, probability, description)
    values (public.allocate_crm_number('opportunity'), v_title, (p_new_opportunity ->> 'subject_id')::uuid,
      'lead', 'open', 'medium', v_value, 25, 'Vytvořeno při založení obchodního dokumentu.')
    returning * into v_opportunity;
  else
    select * into v_opportunity from public.crm_opportunities where id = p_opportunity_id for update;
    if not found then raise exception 'CRM opportunity not found'; end if;
  end if;
  if v_opportunity.deleted_at is not null or v_opportunity.archived_at is not null or v_opportunity.cancelled_at is not null then
    raise exception 'An inactive opportunity cannot receive a new document';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.sort_order, item.id), '[]'::jsonb)
    into v_items from public.crm_opportunity_items item where opportunity_id = v_opportunity.id;
  if jsonb_array_length(v_items) = 0 then
    v_items := jsonb_build_array(jsonb_build_object('code', 'CRM-001', 'name', v_opportunity.title,
      'quantity', 1, 'unit', 'ks', 'unit_price', v_opportunity.value, 'discount_percent', 0, 'vat_rate', 21));
    perform public.replace_crm_opportunity_items(v_opportunity.id, v_items, true);
  end if;

  insert into public.crm_commercial_documents (opportunity_id, subject_id, type, status, number, title, issue_date, notes, sync_items)
  values (v_opportunity.id, v_opportunity.subject_id, p_type, 'draft', public.allocate_crm_number(p_type),
    (case p_type when 'offer' then 'Nabídka' else 'Objednávka' end) || ' - ' || v_opportunity.title,
    current_date, p_notes, true)
  returning * into v_document;
  perform public.replace_crm_document_items(v_document.id, v_items);
  select * into v_document from public.crm_commercial_documents where id = v_document.id;
  return to_jsonb(v_document);
end;
$$;

create or replace function public.relate_crm_commercial_document_atomic(
  p_document_id uuid,
  p_target_opportunity_id uuid,
  p_action text,
  p_item_mode text,
  p_items jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.crm_commercial_documents%rowtype;
  v_document public.crm_commercial_documents%rowtype;
  v_target public.crm_opportunities%rowtype;
  v_items jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_crm() then raise exception 'CRM edit permission required'; end if;
  if exists (select 1 from public.user_account_status where auth_user_id = auth.uid() and status = 'disabled') then
    raise exception 'Account is disabled';
  end if;
  if p_action is null or p_action not in ('move', 'copy') then raise exception 'Invalid relation action'; end if;
  if p_item_mode is null or p_item_mode not in ('target-sync', 'current-copy') then raise exception 'Invalid item mode'; end if;
  select * into v_target from public.crm_opportunities where id = p_target_opportunity_id for update;
  if not found then raise exception 'Target CRM opportunity not found'; end if;
  if v_target.deleted_at is not null or v_target.archived_at is not null or v_target.cancelled_at is not null then
    raise exception 'Target CRM opportunity is inactive';
  end if;
  select * into v_source from public.crm_commercial_documents where id = p_document_id for update;
  if not found or v_source.deleted_at is not null then raise exception 'Source commercial document not found'; end if;
  if p_action = 'move' and (v_source.status <> 'draft' or v_source.archived_at is not null or v_source.cancelled_at is not null) then
    raise exception 'Only an active draft document can be moved';
  end if;

  if p_item_mode = 'target-sync' then
    select coalesce(jsonb_agg(to_jsonb(item) order by item.sort_order, item.id), '[]'::jsonb)
      into v_items from public.crm_opportunity_items item where opportunity_id = v_target.id;
  elsif p_items is not null then
    if jsonb_typeof(p_items) <> 'array' then raise exception 'Document items must be an array'; end if;
    v_items := p_items;
  else
    select coalesce(jsonb_agg(to_jsonb(item) order by item.sort_order, item.id), '[]'::jsonb)
      into v_items from public.crm_commercial_document_items item where document_id = v_source.id;
  end if;

  if p_action = 'copy' then
    insert into public.crm_commercial_documents (
      opportunity_id, subject_id, type, status, number, title, issue_date, valid_until, currency, notes, sync_items
    ) values (v_target.id, v_target.subject_id, v_source.type, 'draft', public.allocate_crm_number(v_source.type),
      v_source.title, current_date, v_source.valid_until, v_source.currency, v_source.notes, p_item_mode = 'target-sync')
    returning * into v_document;
  else
    update public.crm_commercial_documents set opportunity_id = v_target.id, subject_id = v_target.subject_id,
      sync_items = p_item_mode = 'target-sync', updated_at = now()
    where id = v_source.id returning * into v_document;
  end if;
  -- Keep a complete snapshot even for synchronized drafts. This makes later
  -- finalization and exports correct without relying on a client-side join.
  perform public.replace_crm_document_items(v_document.id, v_items);
  select * into v_document from public.crm_commercial_documents where id = v_document.id;
  return to_jsonb(v_document);
end;
$$;

create or replace function public.save_product_set_atomic(p_set_id uuid, p_set jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_set public.product_sets%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists (select 1 from public.user_account_status where auth_user_id = auth.uid() and status = 'disabled') then
    raise exception 'Account is disabled';
  end if;
  if not (coalesce(public.get_user_role() = 'admin', false) or exists (
    select 1 from public.role_permissions where role = public.get_user_role()
      and module in ('crm', 'settings') and (can_edit = true or can_admin = true)
  )) then raise exception 'Product set edit permission required'; end if;
  if nullif(btrim(p_set ->> 'name'), '') is null then raise exception 'Product set name is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Product set items must be an array'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Product set requires at least one item'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as item(quantity numeric)
    where item.quantity is null or item.quantity <= 0 or item.quantity::text in ('NaN', 'Infinity', '-Infinity')
  ) then raise exception 'Product set quantities must be positive finite numbers'; end if;

  if p_set_id is null then
    insert into public.product_sets (code, name, category, description, is_active, created_by)
    values (nullif(btrim(p_set ->> 'code'), ''), btrim(p_set ->> 'name'), nullif(btrim(p_set ->> 'category'), ''),
      nullif(btrim(p_set ->> 'description'), ''), coalesce((p_set ->> 'is_active')::boolean, true), auth.uid())
    returning * into v_set;
  else
    select * into v_set from public.product_sets where id = p_set_id for update;
    if not found then raise exception 'Product set not found'; end if;
    update public.product_sets set code = nullif(btrim(p_set ->> 'code'), ''), name = btrim(p_set ->> 'name'),
      category = nullif(btrim(p_set ->> 'category'), ''), description = nullif(btrim(p_set ->> 'description'), ''),
      is_active = coalesce((p_set ->> 'is_active')::boolean, true), updated_at = now()
    where id = p_set_id returning * into v_set;
  end if;
  delete from public.product_set_items where set_id = v_set.id;
  insert into public.product_set_items (set_id, catalog_item_id, quantity, sort_order, note)
  select v_set.id, item.catalog_item_id, item.quantity, coalesce(item.sort_order, 0), nullif(btrim(item.note), '')
  from jsonb_to_recordset(p_items) as item(catalog_item_id uuid, quantity numeric, sort_order integer, note text);
  return to_jsonb(v_set);
end;
$$;

revoke all on function public.create_crm_commercial_document_atomic(uuid, text, jsonb, text) from public, anon;
revoke all on function public.relate_crm_commercial_document_atomic(uuid, uuid, text, text, jsonb) from public, anon;
revoke all on function public.save_product_set_atomic(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.create_crm_commercial_document_atomic(uuid, text, jsonb, text) to authenticated;
grant execute on function public.relate_crm_commercial_document_atomic(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.save_product_set_atomic(uuid, jsonb, jsonb) to authenticated;

-- Commit only the edited fields. Optimistic value checks prevent overwriting a
-- concurrent edit of the same field; jsonb_set preserves every other custom key.
create or replace function public.save_crm_opportunity_fields_atomic(
  p_opportunity_id uuid,
  p_fields jsonb,
  p_expected_fields jsonb,
  p_custom_fields jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_opportunity public.crm_opportunities%rowtype;
  v_patch public.crm_opportunities%rowtype;
  v_key text;
  v_custom_patch jsonb;
  v_custom_fields jsonb;
  v_seen_keys text[] := '{}';
  v_allowed_fields text[] := array['expected_close_date', 'priority', 'probability', 'value', 'currency', 'version_no',
    'business_type', 'category', 'source', 'classification_1', 'classification_2', 'classification_3', 'tags', 'next_step'];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.can_edit_crm() then raise exception 'CRM edit permission required'; end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_expected_fields is null or jsonb_typeof(p_expected_fields) <> 'object' then
    raise exception 'Field changes and expected values must be JSON objects';
  end if;
  if p_custom_fields is null or jsonb_typeof(p_custom_fields) <> 'array' then raise exception 'Custom field changes must be an array'; end if;
  select * into v_opportunity from public.crm_opportunities where id = p_opportunity_id for update;
  if not found then raise exception 'CRM opportunity not found'; end if;
  if v_opportunity.deleted_at is not null or v_opportunity.archived_at is not null or v_opportunity.cancelled_at is not null then
    raise exception 'An inactive opportunity cannot be edited';
  end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not (v_key = any(v_allowed_fields)) then raise exception 'Unsupported opportunity field: %', v_key; end if;
    if not (p_expected_fields ? v_key) then raise exception 'Expected value is required for field %', v_key; end if;
    if (to_jsonb(v_opportunity) -> v_key) is distinct from (p_expected_fields -> v_key) then
      raise exception 'Pole % mezitím upravil jiný uživatel. Rozpracované změny zůstaly zachovány.', v_key using errcode = '40001';
    end if;
  end loop;

  v_patch := jsonb_populate_record(v_opportunity, p_fields);
  if (p_fields ? 'probability') and (v_patch.probability is null or v_patch.probability < 0 or v_patch.probability > 100) then raise exception 'Invalid probability'; end if;
  if (p_fields ? 'value') and (v_patch.value is null or v_patch.value < 0 or v_patch.value::text in ('NaN', 'Infinity', '-Infinity')) then raise exception 'Invalid opportunity value'; end if;
  if (p_fields ? 'version_no') and (v_patch.version_no is null or v_patch.version_no < 1) then raise exception 'Invalid version'; end if;
  if (p_fields ? 'currency') and (v_patch.currency is null or v_patch.currency !~ '^[A-Z]{3}$') then raise exception 'Invalid currency'; end if;
  v_custom_fields := coalesce(v_opportunity.custom_fields, '{}'::jsonb);
  if jsonb_typeof(v_custom_fields) <> 'object' then raise exception 'Existing custom fields must be a JSON object'; end if;
  for v_custom_patch in select value from jsonb_array_elements(p_custom_fields) loop
    v_key := nullif(btrim(v_custom_patch ->> 'key'), '');
    if v_key is null or length(v_key) > 200 or v_key in ('__proto__', 'constructor', 'prototype') then raise exception 'Invalid custom field key'; end if;
    if v_key = any(v_seen_keys) then raise exception 'Duplicate custom field key'; end if;
    v_seen_keys := array_append(v_seen_keys, v_key);
    if not (v_custom_patch ? 'expected_value') then raise exception 'Expected custom field value is required'; end if;
    if coalesce(v_custom_fields -> v_key, 'null'::jsonb) is distinct from coalesce(v_custom_patch -> 'expected_value', 'null'::jsonb) then
      raise exception 'Vlastní pole % mezitím upravil jiný uživatel. Rozpracované změny zůstaly zachovány.', v_key using errcode = '40001';
    end if;
    v_custom_fields := jsonb_set(v_custom_fields, array[v_key], coalesce(v_custom_patch -> 'value', 'null'::jsonb), true);
  end loop;
  update public.crm_opportunities set
    expected_close_date = v_patch.expected_close_date, priority = v_patch.priority, probability = v_patch.probability,
    value = v_patch.value, currency = v_patch.currency, version_no = v_patch.version_no, business_type = v_patch.business_type,
    category = v_patch.category, source = v_patch.source, classification_1 = v_patch.classification_1,
    classification_2 = v_patch.classification_2, classification_3 = v_patch.classification_3,
    tags = v_patch.tags, next_step = v_patch.next_step, custom_fields = v_custom_fields, updated_at = now()
  where id = p_opportunity_id returning * into v_opportunity;
  return to_jsonb(v_opportunity);
end;
$$;
revoke all on function public.save_crm_opportunity_fields_atomic(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_crm_opportunity_fields_atomic(uuid, jsonb, jsonb, jsonb) to authenticated;

commit;
