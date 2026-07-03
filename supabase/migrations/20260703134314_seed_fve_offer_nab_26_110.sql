-- Seed imported from NAB-26-110.xlsx: industrial FVE reference offer.
-- Keeps the example editable in CRM/FVE offer rules and product catalog.
do $$
declare
  v_rule_set_id uuid;
  v_catalog_id uuid;
begin
  select id into v_rule_set_id from public.fve_offer_rule_sets where name = 'FVE průmyslová 96 kWp - NAB-26-110' limit 1;
  if v_rule_set_id is null then
    insert into public.fve_offer_rule_sets (name, description, is_active, min_power_kwp, max_power_kwp, roof_type, customer_type, sort_order)
    values ('FVE průmyslová 96 kWp - NAB-26-110', 'Referenční pravidlová sada importovaná z Excel nabídky NAB-26-110. Obsahuje skupiny panely/konstrukce/DC, střídače/AC, elektroměrový rozvaděč a ostatní práce.', true, 80, 120, 'trapezoid', 'company', 20)
    returning id into v_rule_set_id;
  else
    update public.fve_offer_rule_sets
    set description = 'Referenční pravidlová sada importovaná z Excel nabídky NAB-26-110. Obsahuje skupiny panely/konstrukce/DC, střídače/AC, elektroměrový rozvaděč a ostatní práce.',
        is_active = true, min_power_kwp = 80, max_power_kwp = 120, roof_type = 'trapezoid', customer_type = 'company', sort_order = 20, updated_at = now()
    where id = v_rule_set_id;
  end if;

  delete from public.fve_offer_rule_items where rule_set_id = v_rule_set_id;

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-11') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-11', 'DHN-54Z16/DG(BW)-510W', '1. Panely, konstrukce, DC část', '1. Panely, konstrukce, DC část', 'ks', 2692.31, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 11, "source_group": 1, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'DHN-54Z16/DG(BW)-510W', description = '1. Panely, konstrukce, DC část', category = '1. Panely, konstrukce, DC část', unit = 'ks', default_unit_price = 2692.31, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 11, "source_group": 1, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'panel', 'NAB26110-11', 'DHN-54Z16/DG(BW)-510W', '1. Panely, konstrukce, DC část', 'ks', 'fixed', 189.0, 2692.31, 2100.0, 0.0, 0, false, 10);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-12') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-12', 'Konstrukce novotegra – trapéz', '1. Panely, konstrukce, DC část', '1. Panely, konstrukce, DC část', 'ks', 1794.87, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 12, "source_group": 1, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Konstrukce novotegra – trapéz', description = '1. Panely, konstrukce, DC část', category = '1. Panely, konstrukce, DC část', unit = 'ks', default_unit_price = 1794.87, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 12, "source_group": 1, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'mounting', 'NAB26110-12', 'Konstrukce novotegra – trapéz', '1. Panely, konstrukce, DC část', 'ks', 'fixed', 189.0, 1794.87, 1400.0, 0.0, 0, false, 20);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-13') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-13', 'S1400-1GM4MBWD', '1. Panely, konstrukce, DC část', '1. Panely, konstrukce, DC část', 'ks', 2179.49, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 13, "source_group": 1, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'S1400-1GM4MBWD', description = '1. Panely, konstrukce, DC část', category = '1. Panely, konstrukce, DC část', unit = 'ks', default_unit_price = 2179.49, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 13, "source_group": 1, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'dc', 'NAB26110-13', 'S1400-1GM4MBWD', '1. Panely, konstrukce, DC část', 'ks', 'fixed', 95.0, 2179.49, 1700.0, 0.0, 0, false, 30);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-14') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-14', 'Rozvaděč DC – provedení venkovní', '1. Panely, konstrukce, DC část', '1. Panely, konstrukce, DC část', 'ks', 57692.31, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 14, "source_group": 1, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Rozvaděč DC – provedení venkovní', description = '1. Panely, konstrukce, DC část', category = '1. Panely, konstrukce, DC část', unit = 'ks', default_unit_price = 57692.31, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 14, "source_group": 1, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'dc', 'NAB26110-14', 'Rozvaděč DC – provedení venkovní', '1. Panely, konstrukce, DC část', 'ks', 'fixed', 1.0, 57692.31, 45000.0, 0.0, 0, false, 40);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-15') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-15', 'Pospojení konstrukce a panelů vč. napojení na MET (DC svodiče T1T2)', '1. Panely, konstrukce, DC část', '1. Panely, konstrukce, DC část', 'ks', 3333.33, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 15, "source_group": 1, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Pospojení konstrukce a panelů vč. napojení na MET (DC svodiče T1T2)', description = '1. Panely, konstrukce, DC část', category = '1. Panely, konstrukce, DC část', unit = 'ks', default_unit_price = 3333.33, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 15, "source_group": 1, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'panel', 'NAB26110-15', 'Pospojení konstrukce a panelů vč. napojení na MET (DC svodiče T1T2)', '1. Panely, konstrukce, DC část', 'ks', 'fixed', 6.0, 3333.33, 2600.0, 0.0, 0, false, 50);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-16') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-16', 'Solární kabely a konektory MC4, DC kabelové trasy na střeše', '1. Panely, konstrukce, DC část', '1. Panely, konstrukce, DC část', 'kpl', 64102.56, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 16, "source_group": 1, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Solární kabely a konektory MC4, DC kabelové trasy na střeše', description = '1. Panely, konstrukce, DC část', category = '1. Panely, konstrukce, DC část', unit = 'kpl', default_unit_price = 64102.56, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 16, "source_group": 1, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'dc', 'NAB26110-16', 'Solární kabely a konektory MC4, DC kabelové trasy na střeše', '1. Panely, konstrukce, DC část', 'kpl', 'fixed', 1.0, 64102.56, 50000.0, 0.0, 0, false, 60);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-17') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-17', 'Instalace konstrukce, panelů a DC rozvodů', '1. Panely, konstrukce, DC část', '1. Panely, konstrukce, DC část', 'ks', 1538.46, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 17, "source_group": 1, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Instalace konstrukce, panelů a DC rozvodů', description = '1. Panely, konstrukce, DC část', category = '1. Panely, konstrukce, DC část', unit = 'ks', default_unit_price = 1538.46, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 17, "source_group": 1, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'panel', 'NAB26110-17', 'Instalace konstrukce, panelů a DC rozvodů', '1. Panely, konstrukce, DC část', 'ks', 'fixed', 189.0, 1538.46, 1200.0, 0.0, 0, false, 70);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-18') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-18', 'Kabelové žlaby – kovové', '1. Panely, konstrukce, DC část', '1. Panely, konstrukce, DC část', 'm', 448.72, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 18, "source_group": 1, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Kabelové žlaby – kovové', description = '1. Panely, konstrukce, DC část', category = '1. Panely, konstrukce, DC část', unit = 'm', default_unit_price = 448.72, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 18, "source_group": 1, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'dc', 'NAB26110-18', 'Kabelové žlaby – kovové', '1. Panely, konstrukce, DC část', 'm', 'fixed', 100.0, 448.72, 350.0, 0.0, 0, false, 80);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-19') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-19', 'A-Z ROOF SPD T1+T2 2+0 1010 VDC', '1. Panely, konstrukce, DC část', '1. Panely, konstrukce, DC část', 'ks', 3333.33, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 19, "source_group": 1, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'A-Z ROOF SPD T1+T2 2+0 1010 VDC', description = '1. Panely, konstrukce, DC část', category = '1. Panely, konstrukce, DC část', unit = 'ks', default_unit_price = 3333.33, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 19, "source_group": 1, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'mounting', 'NAB26110-19', 'A-Z ROOF SPD T1+T2 2+0 1010 VDC', '1. Panely, konstrukce, DC část', 'ks', 'fixed', 6.0, 3333.33, 2600.0, 0.0, 0, false, 90);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-20') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-20', 'Uzemnění konstrukce FVE', '1. Panely, konstrukce, DC část', '1. Panely, konstrukce, DC část', 'kpl', 51282.05, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 20, "source_group": 1, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Uzemnění konstrukce FVE', description = '1. Panely, konstrukce, DC část', category = '1. Panely, konstrukce, DC část', unit = 'kpl', default_unit_price = 51282.05, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 20, "source_group": 1, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'mounting', 'NAB26110-20', 'Uzemnění konstrukce FVE', '1. Panely, konstrukce, DC část', 'kpl', 'fixed', 1.0, 51282.05, 40000.0, 0.0, 0, false, 100);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-25') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-25', 'SE100K (MC4 CONNECTORS/WITHOUT DC-SWITCH)', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'ks', 134615.38, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 25, "source_group": 2, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'SE100K (MC4 CONNECTORS/WITHOUT DC-SWITCH)', description = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', category = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', unit = 'ks', default_unit_price = 134615.38, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 25, "source_group": 2, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'inverter', 'NAB26110-25', 'SE100K (MC4 CONNECTORS/WITHOUT DC-SWITCH)', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'ks', 'fixed', 1.0, 134615.38, 105000.0, 0.0, 0, false, 110);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-26') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-26', 'SECT-SPL-250A-A', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'ks', 833.33, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 26, "source_group": 2, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'SECT-SPL-250A-A', description = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', category = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', unit = 'ks', default_unit_price = 833.33, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 26, "source_group": 2, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'ac', 'NAB26110-26', 'SECT-SPL-250A-A', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'ks', 'fixed', 3.0, 833.33, 650.0, 0.0, 0, false, 120);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-27') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-27', 'Rozvaděč RFVE AC 50 kW', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'kpl', 96153.85, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 27, "source_group": 2, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Rozvaděč RFVE AC 50 kW', description = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', category = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', unit = 'kpl', default_unit_price = 96153.85, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 27, "source_group": 2, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'ac', 'NAB26110-27', 'Rozvaděč RFVE AC 50 kW', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'kpl', 'fixed', 1.0, 96153.85, 75000.0, 0.0, 0, false, 130);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-28') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-28', 'Tlačítko FVE Total Stop', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'kpl', 1923.08, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 28, "source_group": 2, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Tlačítko FVE Total Stop', description = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', category = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', unit = 'kpl', default_unit_price = 1923.08, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 28, "source_group": 2, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'ac', 'NAB26110-28', 'Tlačítko FVE Total Stop', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'kpl', 'fixed', 1.0, 1923.08, 1500.0, 0.0, 0, false, 140);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-29') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-29', 'Propojovací kabely (AYKY 4×95, datové, HDO)', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'kpl', 26923.08, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 29, "source_group": 2, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Propojovací kabely (AYKY 4×95, datové, HDO)', description = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', category = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', unit = 'kpl', default_unit_price = 26923.08, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 29, "source_group": 2, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'ac', 'NAB26110-29', 'Propojovací kabely (AYKY 4×95, datové, HDO)', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'kpl', 'fixed', 1.0, 26923.08, 21000.0, 0.0, 0, false, 150);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-30') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-30', 'Kabelové chráničky a ostatní drobný materiál', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'kpl', 32051.28, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 30, "source_group": 2, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Kabelové chráničky a ostatní drobný materiál', description = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', category = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', unit = 'kpl', default_unit_price = 32051.28, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 30, "source_group": 2, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'ac', 'NAB26110-30', 'Kabelové chráničky a ostatní drobný materiál', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'kpl', 'fixed', 1.0, 32051.28, 25000.0, 0.0, 0, false, 160);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-31') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-31', 'Elektroinstalační práce', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'kpl', 102564.1, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 31, "source_group": 2, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Elektroinstalační práce', description = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', category = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', unit = 'kpl', default_unit_price = 102564.1, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 31, "source_group": 2, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'ac', 'NAB26110-31', 'Elektroinstalační práce', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'kpl', 'fixed', 1.0, 102564.1, 80000.0, 0.0, 0, false, 170);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-32') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-32', 'SE-MTR-3Y-400V-A (ELM)', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'ks', 3974.36, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 32, "source_group": 2, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'SE-MTR-3Y-400V-A (ELM)', description = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', category = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', unit = 'ks', default_unit_price = 3974.36, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 32, "source_group": 2, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'ac', 'NAB26110-32', 'SE-MTR-3Y-400V-A (ELM)', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'ks', 'fixed', 1.0, 3974.36, 3100.0, 0.0, 0, false, 180);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-33') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-33', 'SS200/NKE1P', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'ks', 11602.56, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 33, "source_group": 2, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'SS200/NKE1P', description = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', category = '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', unit = 'ks', default_unit_price = 11602.56, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 33, "source_group": 2, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'ac', 'NAB26110-33', 'SS200/NKE1P', '2. Střídače, rozvaděče, AC rozvody do NN rozvodny', 'ks', 'fixed', 1.0, 11602.56, 9050.0, 0.0, 0, false, 190);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-38') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-38', 'Výmena NN rozavdeče TS dle PPDS', '3. Elektroměrový rozvaděč včetně instalace', '3. Elektroměrový rozvaděč včetně instalace', 'kpl', 125641.03, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 38, "source_group": 3, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Výmena NN rozavdeče TS dle PPDS', description = '3. Elektroměrový rozvaděč včetně instalace', category = '3. Elektroměrový rozvaděč včetně instalace', unit = 'kpl', default_unit_price = 125641.03, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 38, "source_group": 3, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'metering', 'NAB26110-38', 'Výmena NN rozavdeče TS dle PPDS', '3. Elektroměrový rozvaděč včetně instalace', 'kpl', 'fixed', 1.0, 125641.03, 98000.0, 0.0, 0, false, 200);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-39') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-39', 'Místní provozní předpisy', '3. Elektroměrový rozvaděč včetně instalace', '3. Elektroměrový rozvaděč včetně instalace', 'kpl', 8888.89, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 39, "source_group": 3, "source_margin_percent": 55.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Místní provozní předpisy', description = '3. Elektroměrový rozvaděč včetně instalace', category = '3. Elektroměrový rozvaděč včetně instalace', unit = 'kpl', default_unit_price = 8888.89, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 39, "source_group": 3, "source_margin_percent": 55.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'metering', 'NAB26110-39', 'Místní provozní předpisy', '3. Elektroměrový rozvaděč včetně instalace', 'kpl', 'fixed', 1.0, 8888.89, 4000.0, 0.0, 0, false, 210);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-40') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-40', 'ER 212 NKP7P', '3. Elektroměrový rozvaděč včetně instalace', '3. Elektroměrový rozvaděč včetně instalace', 'ks', 12564.1, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 40, "source_group": 3, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'ER 212 NKP7P', description = '3. Elektroměrový rozvaděč včetně instalace', category = '3. Elektroměrový rozvaděč včetně instalace', unit = 'ks', default_unit_price = 12564.1, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 40, "source_group": 3, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'metering', 'NAB26110-40', 'ER 212 NKP7P', '3. Elektroměrový rozvaděč včetně instalace', 'ks', 'fixed', 1.0, 12564.1, 9800.0, 0.0, 0, false, 220);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-41') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-41', 'PERP 160/160/ČEZ 33.1.23 pilíř', '3. Elektroměrový rozvaděč včetně instalace', '3. Elektroměrový rozvaděč včetně instalace', 'ks', 61538.46, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 41, "source_group": 3, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'PERP 160/160/ČEZ 33.1.23 pilíř', description = '3. Elektroměrový rozvaděč včetně instalace', category = '3. Elektroměrový rozvaděč včetně instalace', unit = 'ks', default_unit_price = 61538.46, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 41, "source_group": 3, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'metering', 'NAB26110-41', 'PERP 160/160/ČEZ 33.1.23 pilíř', '3. Elektroměrový rozvaděč včetně instalace', 'ks', 'fixed', 1.0, 61538.46, 48000.0, 0.0, 0, false, 230);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-45') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-45', 'Projektové dokumentace', '4. Ostatní (dokumentace, dozor, doprava)', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 100000.0, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 45, "source_group": 4, "source_margin_percent": 80.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Projektové dokumentace', description = '4. Ostatní (dokumentace, dozor, doprava)', category = '4. Ostatní (dokumentace, dozor, doprava)', unit = 'kpl', default_unit_price = 100000.0, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 45, "source_group": 4, "source_margin_percent": 80.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'documentation', 'NAB26110-45', 'Projektové dokumentace', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 'fixed', 1.0, 100000.0, 20000.0, 0.0, 0, false, 240);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-46') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-46', 'Statický výpočet', '4. Ostatní (dokumentace, dozor, doprava)', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 36363.64, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 46, "source_group": 4, "source_margin_percent": 45.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Statický výpočet', description = '4. Ostatní (dokumentace, dozor, doprava)', category = '4. Ostatní (dokumentace, dozor, doprava)', unit = 'kpl', default_unit_price = 36363.64, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 46, "source_group": 4, "source_margin_percent": 45.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'documentation', 'NAB26110-46', 'Statický výpočet', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 'fixed', 1.0, 36363.64, 20000.0, 0.0, 0, false, 250);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-47') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-47', 'Měření, revize NN', '4. Ostatní (dokumentace, dozor, doprava)', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 10256.41, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 47, "source_group": 4, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Měření, revize NN', description = '4. Ostatní (dokumentace, dozor, doprava)', category = '4. Ostatní (dokumentace, dozor, doprava)', unit = 'kpl', default_unit_price = 10256.41, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 47, "source_group": 4, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'service', 'NAB26110-47', 'Měření, revize NN', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 'fixed', 1.0, 10256.41, 8000.0, 0.0, 0, false, 260);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-48') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-48', 'Připojení na CEZd', '4. Ostatní (dokumentace, dozor, doprava)', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 6666.67, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 48, "source_group": 4, "source_margin_percent": 70.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Připojení na CEZd', description = '4. Ostatní (dokumentace, dozor, doprava)', category = '4. Ostatní (dokumentace, dozor, doprava)', unit = 'kpl', default_unit_price = 6666.67, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 48, "source_group": 4, "source_margin_percent": 70.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'service', 'NAB26110-48', 'Připojení na CEZd', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 'fixed', 1.0, 6666.67, 2000.0, 0.0, 0, false, 270);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-49') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-49', 'Zajištění pracoviště + mechanizace', '4. Ostatní (dokumentace, dozor, doprava)', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 23076.92, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 49, "source_group": 4, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Zajištění pracoviště + mechanizace', description = '4. Ostatní (dokumentace, dozor, doprava)', category = '4. Ostatní (dokumentace, dozor, doprava)', unit = 'kpl', default_unit_price = 23076.92, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 49, "source_group": 4, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'service', 'NAB26110-49', 'Zajištění pracoviště + mechanizace', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 'fixed', 1.0, 23076.92, 18000.0, 0.0, 0, false, 280);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-50') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-50', 'Doprava', '4. Ostatní (dokumentace, dozor, doprava)', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 44871.79, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 50, "source_group": 4, "source_margin_percent": 22.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Doprava', description = '4. Ostatní (dokumentace, dozor, doprava)', category = '4. Ostatní (dokumentace, dozor, doprava)', unit = 'kpl', default_unit_price = 44871.79, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 50, "source_group": 4, "source_margin_percent": 22.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'service', 'NAB26110-50', 'Doprava', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 'fixed', 1.0, 44871.79, 35000.0, 0.0, 0, false, 290);

  v_catalog_id := null;
  select id into v_catalog_id from public.commercial_item_catalog where lower(code) = lower('NAB26110-52') limit 1;
  if v_catalog_id is null then
    insert into public.commercial_item_catalog (code, name, description, category, unit, default_unit_price, default_vat_rate, source, metadata)
    values ('NAB26110-52', 'Sleva z nabídky NAB-26-110', '4. Ostatní (dokumentace, dozor, doprava)', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', -553664.0, 0.0, 'import', '{"source": "NAB-26-110.xlsx", "source_row": 52, "source_group": 4, "source_margin_percent": 0.0}'::jsonb)
    returning id into v_catalog_id;
  else
    update public.commercial_item_catalog
    set name = 'Sleva z nabídky NAB-26-110', description = '4. Ostatní (dokumentace, dozor, doprava)', category = '4. Ostatní (dokumentace, dozor, doprava)', unit = 'kpl', default_unit_price = -553664.0, default_vat_rate = 0.0, source = 'import', metadata = '{"source": "NAB-26-110.xlsx", "source_row": 52, "source_group": 4, "source_margin_percent": 0.0}'::jsonb, is_active = true, updated_at = now()
    where id = v_catalog_id;
  end if;

  insert into public.fve_offer_rule_items (rule_set_id, catalog_item_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, discount_percent, is_optional, sort_order)
  values (v_rule_set_id, v_catalog_id, 'discount', 'NAB26110-52', 'Sleva z nabídky NAB-26-110', '4. Ostatní (dokumentace, dozor, doprava)', 'kpl', 'fixed', 1.0, -553664.0, 0.0, 0.0, 0, true, 300);

end $$;
