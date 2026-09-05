-- Run ONLY against a disposable local/test Supabase database after migrations:
-- psql <test-connection> -v ON_ERROR_STOP=1 -f supabase/tests/crm_atomic_workflows.sql
-- This suite is transactional and rolls back fixtures, trigger and counters.
-- It uses real constraints/RPCs, not a regex assertion that a function exists.
begin;

create function pg_temp.crm_test_fail_item() returns trigger language plpgsql as $$
begin
  if new.name = '__crm_atomic_forced_failure__' then raise exception 'Forced CRM test item failure'; end if;
  return new;
end;
$$;
create trigger crm_atomic_test_failure before insert on public.crm_commercial_document_items
for each row execute function pg_temp.crm_test_fail_item();

do $$
declare
  v_user uuid := gen_random_uuid();
  v_subject uuid;
  v_product uuid;
  v_target uuid;
  v_created jsonb;
  v_copy jsonb;
  v_set jsonb;
  v_items jsonb;
  v_before_numbering jsonb;
  v_before_opportunities bigint;
  v_before_documents bigint;
  v_failed boolean;
  v_count bigint;
  v_bad_quantity text;
begin
  insert into auth.users (id, email) values (v_user, v_user::text || '@crm-atomic-test.invalid');
  insert into public.members (name, auth_user_id, user_role) values ('CRM atomic test', v_user, 'admin')
    on conflict (auth_user_id) do update set user_role = 'admin';
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  insert into public.subjects (name) values ('CRM atomic fixture') returning id into v_subject;
  insert into public.commercial_item_catalog (name) values ('CRM atomic product') returning id into v_product;

  -- Create + fallback opportunity items + document snapshot are one operation.
  v_created := public.create_crm_commercial_document_atomic(null, 'offer',
    jsonb_build_object('title', 'CRM atomic opportunity', 'subject_id', v_subject, 'value', 125), null);
  if (v_created ->> 'total')::numeric <> 125 then raise exception 'Create financial totals do not match'; end if;
  select count(*) into v_count from public.crm_opportunity_items where opportunity_id = (v_created ->> 'opportunity_id')::uuid;
  if v_count <> 1 then raise exception 'Fallback OP item is missing'; end if;
  select count(*) into v_count from public.crm_commercial_document_items where document_id = (v_created ->> 'id')::uuid;
  if v_count <> 1 then raise exception 'Created document snapshot is missing'; end if;

  insert into public.crm_opportunities (title, subject_id) values ('CRM atomic target', v_subject) returning id into v_target;
  v_items := jsonb_build_array(jsonb_build_object('catalog_item_id', v_product, 'name', 'Snapshot',
    'quantity', 2, 'unit', 'ks', 'unit_price', 100, 'unit_cost', 60, 'vat_rate', 21));
  perform public.replace_crm_opportunity_items(v_target, v_items, true);
  v_copy := public.relate_crm_commercial_document_atomic((v_created ->> 'id')::uuid, v_target, 'copy', 'target-sync');
  if (v_copy ->> 'total')::numeric <> 200 or (v_copy ->> 'cost_total')::numeric <> 120 then
    raise exception 'Target-sync copy does not use target server items';
  end if;
  select count(*) into v_count from public.crm_commercial_document_items where document_id = (v_copy ->> 'id')::uuid;
  if v_count <> 1 then raise exception 'Synchronized copy snapshot is missing'; end if;

  -- An item error must roll back a copy header and its allocated number.
  select count(*) into v_before_documents from public.crm_commercial_documents;
  select jsonb_agg(to_jsonb(s) order by document_type) into v_before_numbering from public.crm_numbering_settings s;
  v_failed := false;
  begin
    perform public.relate_crm_commercial_document_atomic((v_created ->> 'id')::uuid, v_target, 'copy', 'current-copy',
      jsonb_build_array(jsonb_build_object('catalog_item_id', gen_random_uuid(), 'name', 'Invalid', 'quantity', 1, 'unit_price', 1)));
  exception when foreign_key_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'Invalid item was accepted'; end if;
  if (select count(*) from public.crm_commercial_documents) <> v_before_documents then raise exception 'Failed copy left a header'; end if;
  if (select jsonb_agg(to_jsonb(s) order by document_type) from public.crm_numbering_settings s) is distinct from v_before_numbering then
    raise exception 'Failed copy consumed a document number';
  end if;

  -- A move failure must preserve both the old relation and item snapshot.
  v_failed := false;
  begin
    perform public.relate_crm_commercial_document_atomic((v_created ->> 'id')::uuid, v_target, 'move', 'current-copy',
      jsonb_build_array(jsonb_build_object('catalog_item_id', gen_random_uuid(), 'name', 'Invalid', 'quantity', 1, 'unit_price', 1)));
  exception when foreign_key_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'Invalid move was accepted'; end if;
  if (select opportunity_id from public.crm_commercial_documents where id = (v_created ->> 'id')::uuid) <> (v_created ->> 'opportunity_id')::uuid then
    raise exception 'Failed move changed the relation';
  end if;
  if (select sum(line_total) from public.crm_commercial_document_items where document_id = (v_created ->> 'id')::uuid) <> 125 then
    raise exception 'Failed move destroyed original items';
  end if;

  -- Failure while constructing a new OP/document must undo even the new OP.
  select count(*) into v_before_opportunities from public.crm_opportunities;
  v_failed := false;
  begin
    perform public.create_crm_commercial_document_atomic(null, 'offer',
      jsonb_build_object('title', '__crm_atomic_forced_failure__', 'subject_id', v_subject, 'value', 50), null);
  exception when raise_exception then
    if sqlerrm <> 'Forced CRM test item failure' then raise; end if;
    v_failed := true;
  end;
  if not v_failed then raise exception 'Forced create failure was not exercised'; end if;
  if (select count(*) from public.crm_opportunities) <> v_before_opportunities then raise exception 'Failed create left an opportunity'; end if;
  if (select count(*) from public.crm_commercial_documents) <> v_before_documents then raise exception 'Failed create left a document'; end if;
  if (select jsonb_agg(to_jsonb(s) order by document_type) from public.crm_numbering_settings s) is distinct from v_before_numbering then
    raise exception 'Failed create consumed a number';
  end if;

  -- Switching from own items to synchronized items before finalizing must
  -- persist the same snapshot that a later export will read.
  update public.crm_commercial_documents set sync_items = false where id = (v_copy ->> 'id')::uuid;
  v_items := jsonb_build_array(jsonb_build_object('name', 'Final snapshot', 'quantity', 1, 'unit_price', 321, 'unit_cost', 123));
  perform public.save_crm_commercial_document_draft((v_copy ->> 'id')::uuid,
    jsonb_build_object('status', 'sent', 'subject_id', v_subject), v_items, true);
  if (select sum(line_total) from public.crm_commercial_document_items where document_id = (v_copy ->> 'id')::uuid) <> 321 then
    raise exception 'Finalized snapshot is stale after synchronization switch';
  end if;
  v_failed := false;
  begin
    perform public.relate_crm_commercial_document_atomic((v_copy ->> 'id')::uuid, (v_created ->> 'opportunity_id')::uuid, 'move', 'target-sync');
  exception when raise_exception then v_failed := true;
  end;
  if not v_failed then raise exception 'Finalized document was moved'; end if;

  v_set := public.save_product_set_atomic(null, jsonb_build_object('name', 'Original set'),
    jsonb_build_array(jsonb_build_object('catalog_item_id', v_product, 'quantity', 2)));
  v_failed := false;
  begin
    perform public.save_product_set_atomic((v_set ->> 'id')::uuid, jsonb_build_object('name', 'Corrupted set'),
      jsonb_build_array(jsonb_build_object('catalog_item_id', gen_random_uuid(), 'quantity', 3)));
  exception when foreign_key_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'Invalid set item was accepted'; end if;
  if (select name from public.product_sets where id = (v_set ->> 'id')::uuid) <> 'Original set' then raise exception 'Failed set save changed header'; end if;
  if (select sum(quantity) from public.product_set_items where set_id = (v_set ->> 'id')::uuid) <> 2 then raise exception 'Failed set save lost its items'; end if;

  foreach v_bad_quantity in array array['NaN', 'Infinity', '-Infinity', '0', '-1'] loop
    v_failed := false;
    begin
      perform public.save_product_set_atomic((v_set ->> 'id')::uuid, jsonb_build_object('name', 'Invalid quantity set'),
        jsonb_build_array(jsonb_build_object('catalog_item_id', v_product, 'quantity', v_bad_quantity)));
    exception when raise_exception then
      if sqlerrm <> 'Product set quantities must be positive finite numbers' then raise; end if;
      v_failed := true;
    end;
    if not v_failed then raise exception 'Invalid quantity % was accepted', v_bad_quantity; end if;
    if (select name from public.product_sets where id = (v_set ->> 'id')::uuid) <> 'Original set' then raise exception 'Invalid quantity changed set header'; end if;
    if (select sum(quantity) from public.product_set_items where set_id = (v_set ->> 'id')::uuid) <> 2 then raise exception 'Invalid quantity replaced existing items'; end if;
  end loop;

  -- Independent custom-key changes must merge, not replace the JSON object.
  perform public.save_crm_opportunity_fields_atomic((v_created ->> 'opportunity_id')::uuid,
    jsonb_build_object('category', 'Audit'), jsonb_build_object('category', null),
    jsonb_build_array(jsonb_build_object('key', 'first_field', 'value', 'first', 'expected_value', null)));
  perform public.save_crm_opportunity_fields_atomic((v_created ->> 'opportunity_id')::uuid, '{}'::jsonb, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('key', 'second_field', 'value', 'second', 'expected_value', null)));
  if (select custom_fields from public.crm_opportunities where id = (v_created ->> 'opportunity_id')::uuid)
      <> jsonb_build_object('first_field', 'first', 'second_field', 'second') then
    raise exception 'Custom field update overwrote an unrelated key';
  end if;

  -- A stale same-key value rejects the whole draft, including ordinary fields.
  v_failed := false;
  begin
    perform public.save_crm_opportunity_fields_atomic((v_created ->> 'opportunity_id')::uuid,
      jsonb_build_object('next_step', 'Must not be saved'), jsonb_build_object('next_step', null),
      jsonb_build_array(jsonb_build_object('key', 'first_field', 'value', 'overwrite', 'expected_value', null)));
  exception when serialization_failure then v_failed := true;
  end;
  if not v_failed then raise exception 'Stale custom field update was accepted'; end if;
  if (select next_step from public.crm_opportunities where id = (v_created ->> 'opportunity_id')::uuid) is not null then
    raise exception 'Custom field conflict partially saved ordinary fields';
  end if;
  if (select custom_fields ->> 'first_field' from public.crm_opportunities where id = (v_created ->> 'opportunity_id')::uuid) <> 'first' then
    raise exception 'Custom field conflict overwrote the current value';
  end if;

  v_failed := false;
  begin
    perform public.save_crm_opportunity_fields_atomic((v_created ->> 'opportunity_id')::uuid,
      jsonb_build_object('category', 'Overwrite'), jsonb_build_object('category', null), '[]'::jsonb);
  exception when serialization_failure then v_failed := true;
  end;
  if not v_failed then raise exception 'Stale ordinary field update was accepted'; end if;

  if has_function_privilege('authenticated', 'public.replace_crm_opportunity_items_financial_v1(uuid,jsonb,boolean)', 'EXECUTE') then
    raise exception 'Unlocked financial function must remain private';
  end if;
  if has_function_privilege('anon', 'public.create_crm_commercial_document_atomic(uuid,text,jsonb,text)', 'EXECUTE') then
    raise exception 'Anonymous users can execute CRM writes';
  end if;
  insert into public.user_account_status(auth_user_id, status) values (v_user, 'disabled');
  v_failed := false;
  begin
    perform public.create_crm_commercial_document_atomic((v_created ->> 'opportunity_id')::uuid, 'offer');
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'Disabled account could create a document'; end if;
  raise notice 'CRM atomic workflow transaction tests passed';
end;
$$;

rollback;
