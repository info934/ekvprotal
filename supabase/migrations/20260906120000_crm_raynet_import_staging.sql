-- Auditable, idempotent Raynet -> EKV CRM import. Credentials are intentionally
-- not stored here; the Edge Function receives them for the current request only.

begin;

-- Ready-to-use FVE layout derived from the active EKV Raynet opportunity model.
insert into public.crm_custom_field_sections (business_type, title, description, sort_order, is_active)
values
  ('fve', 'Specifikace PD', 'Typ dokumentace a odpovědné osoby.', 5, true),
  ('fve', 'Fakturace', 'Zálohová faktura a její stav.', 10, true),
  ('fve', 'SharePoint / API', 'Identifikátory zakázky a externích úložišť.', 20, true),
  ('fve', 'Identifikace nemovitosti', 'Parcela, katastr a adresa instalace.', 30, true),
  ('fve', 'Konfigurace FVE', 'Výkon, akumulace, stringy a záloha.', 40, true),
  ('fve', 'Panely', 'Výrobce, typ, počet, výkon a záruky panelů.', 50, true),
  ('fve', 'Stridac a baterie', 'Střídač, baterie, BMS a sériová čísla.', 60, true),
  ('fve', 'Specifikace výrobny', 'PPP, EAN, SOP, jistič a způsob provozu.', 65, true),
  ('fve', 'Dotace', 'Požadavek, akceptace a částka dotace.', 70, true),
  ('fve', 'Wallbox', 'Typ, sériové číslo a výkon nabíječky.', 72, true),
  ('fve', 'Parametry instalace', 'Střecha, hromosvod, uzemnění a konstrukce.', 75, true),
  ('fve', 'Dokumentace', 'Revize a fotodokumentace provedení.', 80, true),
  ('fve', 'Certifikát zařízení', 'Autor, číslo a datum certifikátu pro VM.', 90, true)
on conflict (business_type, title) do update set
  description = excluded.description, sort_order = excluded.sort_order, is_active = true;

insert into public.crm_custom_field_definitions
  (section_id, field_key, label, field_type, template_key, options, is_required, is_active, sort_order)
select section.id, field.field_key, field.label, field.field_type, field.field_key, field.options::jsonb, field.is_required, true, field.sort_order
from public.crm_custom_field_sections section
join (
  values
    ('Specifikace PD', 'pd_type', 'Typ PD', 'select', '["FVE_ZAKLAD","FVE_ROZSIRENA","FVE_VYROBNA"]', true, 10),
    ('Specifikace PD', 'designer', 'Projektant', 'text', '[]', false, 20),
    ('Specifikace PD', 'responsible_person', 'Zodpovědná osoba', 'text', '[]', false, 30),
    ('Fakturace', 'advance_invoice_name', 'Zálohová faktura – název', 'text', '[]', false, 10),
    ('Fakturace', 'advance_invoice_amount', 'Zálohová faktura – částka', 'number', '[]', false, 20),
    ('Fakturace', 'advance_invoice_status', 'Zálohová faktura – stav', 'select', '["nepřipravena","vystavena","odeslána","uhrazena"]', false, 30),
    ('Fakturace', 'advance_invoice_url', 'Zálohová faktura – odkaz', 'url', '[]', false, 40),
    ('SharePoint / API', 'external_job_id', 'ID zakázky', 'text', '[]', false, 10),
    ('SharePoint / API', 'sharepoint_folder', 'SharePoint složka', 'url', '[]', false, 20),
    ('SharePoint / API', 'reward_table_id', 'ID tabulky odměn', 'text', '[]', false, 30),
    ('Identifikace nemovitosti', 'parcel_number', 'Parcelní číslo', 'text', '[]', false, 10),
    ('Identifikace nemovitosti', 'cadastral_municipality', 'Obec (katastr)', 'text', '[]', false, 20),
    ('Identifikace nemovitosti', 'cadastral_area_name', 'Katastrální území – název', 'text', '[]', false, 30),
    ('Identifikace nemovitosti', 'cadastral_area_code', 'Katastrální území – číslo', 'text', '[]', false, 40),
    ('Identifikace nemovitosti', 'title_deed_number', 'Číslo LV', 'text', '[]', false, 50),
    ('Identifikace nemovitosti', 'installation_street', 'Ulice', 'text', '[]', false, 60),
    ('Identifikace nemovitosti', 'installation_house_number', 'Číslo popisné', 'text', '[]', false, 70),
    ('Identifikace nemovitosti', 'installation_postal_code', 'PSČ', 'text', '[]', false, 80),
    ('Identifikace nemovitosti', 'installation_city', 'Obec', 'text', '[]', false, 90),
    ('Identifikace nemovitosti', 'installation_region', 'Kraj', 'text', '[]', false, 100),
    ('Konfigurace FVE', 'system_power_kwp', 'Výkon FVE', 'number', '[]', true, 10),
    ('Konfigurace FVE', 'battery_capacity_kwh', 'Akumulace', 'number', '[]', false, 20),
    ('Konfigurace FVE', 'charger_power_kw', 'Nabíječka', 'number', '[]', false, 30),
    ('Konfigurace FVE', 'string_count', 'Počet stringů', 'number', '[]', false, 40),
    ('Konfigurace FVE', 'string_1_panel_count', 'String 1 – počet panelů', 'number', '[]', false, 50),
    ('Konfigurace FVE', 'string_2_panel_count', 'String 2 – počet panelů', 'number', '[]', false, 60),
    ('Konfigurace FVE', 'string_3_panel_count', 'String 3 – počet panelů', 'number', '[]', false, 70),
    ('Konfigurace FVE', 'backup_mode', 'Back-up', 'select', '["bez zálohy","zálohované okruhy","celý objekt"]', false, 80),
    ('Panely', 'panel_brand', 'Značka panelů', 'text', '[]', false, 10),
    ('Panely', 'panel_type', 'Typ panelů', 'text', '[]', false, 20),
    ('Panely', 'panel_count', 'Počet panelů', 'number', '[]', true, 30),
    ('Panely', 'panel_power_wp', 'Výkon panelu', 'number', '[]', false, 40),
    ('Panely', 'panel_dimensions', 'Rozměry panelu', 'text', '[]', false, 50),
    ('Panely', 'panel_mechanical_warranty_months', 'Mechanická záruka (měsíce)', 'number', '[]', false, 60),
    ('Panely', 'panel_performance_warranty_months', 'Výkonová záruka (měsíce)', 'number', '[]', false, 70),
    ('Stridac a baterie', 'inverter_brand', 'Značka střídače', 'text', '[]', false, 10),
    ('Stridac a baterie', 'inverter_type', 'Typ střídače', 'text', '[]', true, 20),
    ('Stridac a baterie', 'inverter_power_kw', 'Výkon střídače', 'number', '[]', false, 30),
    ('Stridac a baterie', 'inverter_serial_number', 'Sériové číslo střídače', 'text', '[]', false, 40),
    ('Stridac a baterie', 'inverter_warranty_months', 'Záruka střídače (měsíce)', 'number', '[]', false, 50),
    ('Stridac a baterie', 'inverter_firmware', 'Verze firmware', 'text', '[]', false, 60),
    ('Stridac a baterie', 'inverter_grid_profile', 'Síťové nastavení', 'text', '[]', false, 70),
    ('Stridac a baterie', 'battery_brand', 'Značka baterie', 'text', '[]', false, 80),
    ('Stridac a baterie', 'battery_type', 'Typ baterie', 'text', '[]', false, 90),
    ('Stridac a baterie', 'battery_warranty_months', 'Záruka baterie (měsíce)', 'number', '[]', false, 100),
    ('Stridac a baterie', 'battery_serial_1', 'Sériové číslo baterie 1', 'text', '[]', false, 110),
    ('Stridac a baterie', 'battery_serial_2', 'Sériové číslo baterie 2', 'text', '[]', false, 120),
    ('Stridac a baterie', 'battery_serial_3', 'Sériové číslo baterie 3', 'text', '[]', false, 130),
    ('Stridac a baterie', 'bms_type', 'Typ BMS', 'text', '[]', false, 140),
    ('Stridac a baterie', 'bms_serial_number', 'Sériové číslo BMS', 'text', '[]', false, 150),
    ('Specifikace výrobny', 'ppp_submitted', 'Žádost o PPP podána', 'boolean', '[]', false, 10),
    ('Specifikace výrobny', 'ppp_request_number', 'Číslo žádosti PPP', 'text', '[]', false, 20),
    ('Specifikace výrobny', 'production_documentation_approved', 'Schválena PD výrobny', 'boolean', '[]', false, 30),
    ('Specifikace výrobny', 'metering_point_number', 'Číslo odběrného místa', 'text', '[]', false, 40),
    ('Specifikace výrobny', 'ean_consumption', 'EAN spotřeba', 'text', '[]', false, 50),
    ('Specifikace výrobny', 'ean_production', 'EAN výroba', 'text', '[]', false, 60),
    ('Specifikace výrobny', 'connection_conditions_number', 'Číslo technických podmínek připojení', 'text', '[]', false, 70),
    ('Specifikace výrobny', 'connection_agreement_valid_until', 'Platnost SOP', 'date', '[]', false, 80),
    ('Specifikace výrobny', 'plant_type', 'Druh výrobny', 'text', '[]', false, 90),
    ('Specifikace výrobny', 'connection_phase_count', 'Počet fází', 'number', '[]', false, 100),
    ('Specifikace výrobny', 'breaker_rating_a', 'Hodnota jističe', 'number', '[]', false, 110),
    ('Specifikace výrobny', 'breaker_curve', 'Vypínací charakteristika', 'text', '[]', false, 120),
    ('Specifikace výrobny', 'operation_mode', 'Způsob provozu', 'text', '[]', false, 130),
    ('Dotace', 'subsidy_request_number', 'Číslo požadavku', 'text', '[]', false, 10),
    ('Dotace', 'subsidy_accepted', 'Akceptována', 'boolean', '[]', false, 20),
    ('Dotace', 'subsidy_accepted_at', 'Datum akceptace', 'date', '[]', false, 30),
    ('Dotace', 'subsidy_amount', 'Nárok na dotaci', 'number', '[]', false, 40),
    ('Wallbox', 'wallbox_type', 'Typ wallboxu', 'text', '[]', false, 10),
    ('Wallbox', 'wallbox_serial_number', 'Sériové číslo wallboxu', 'text', '[]', false, 20),
    ('Wallbox', 'wallbox_power_kw', 'Výkon wallboxu', 'number', '[]', false, 30),
    ('Parametry instalace', 'roof_type', 'Typ střechy', 'select', '["šikmá","rovná","zemní instalace"]', false, 10),
    ('Parametry instalace', 'roof_covering', 'Typ střešní krytiny', 'text', '[]', false, 20),
    ('Parametry instalace', 'roof_pitch_1', 'Sklon střechy PV1', 'number', '[]', false, 30),
    ('Parametry instalace', 'roof_pitch_2', 'Sklon střechy PV2', 'number', '[]', false, 40),
    ('Parametry instalace', 'lightning_protection', 'Hromosvod', 'text', '[]', false, 50),
    ('Parametry instalace', 'lightning_bonding', 'Propojení s hromosvodem', 'select', '["ano","ne","dle projektu"]', false, 60),
    ('Parametry instalace', 'facade_grounding', 'Uzemnění po fasádě', 'boolean', '[]', false, 70),
    ('Parametry instalace', 'pen_conductor_route', 'Tažení vodiče PEN', 'boolean', '[]', false, 80),
    ('Parametry instalace', 'mounting_type', 'Typ konstrukce', 'text', '[]', false, 90),
    ('Parametry instalace', 'eaves_height_m', 'Výška domu k okapu', 'number', '[]', false, 100),
    ('Parametry instalace', 'installation_notes', 'Popis instalace', 'textarea', '[]', false, 110),
    ('Parametry instalace', 'installation_price', 'Cena za instalaci', 'number', '[]', false, 120),
    ('Dokumentace', 'fve_inspection_url', 'Revize FVE', 'url', '[]', false, 10),
    ('Dokumentace', 'wallbox_inspection_url', 'Revize wallboxu', 'url', '[]', false, 20),
    ('Dokumentace', 'switchboard_photo_url', 'Foto rozvaděče', 'url', '[]', false, 30),
    ('Dokumentace', 'inverter_photo_url', 'Foto střídače', 'url', '[]', false, 40),
    ('Dokumentace', 'dc_photo_url', 'Foto DC', 'url', '[]', false, 50),
    ('Dokumentace', 'panels_photo_url', 'Foto panelů', 'url', '[]', false, 60),
    ('Certifikát zařízení', 'certificate_authority', 'Autor certifikátu', 'text', '[]', false, 10),
    ('Certifikát zařízení', 'certificate_number', 'Číslo certifikátu', 'text', '[]', false, 20),
    ('Certifikát zařízení', 'certificate_issued_at', 'Datum vydání certifikátu', 'date', '[]', false, 30)
) as field(section_title, field_key, label, field_type, options, is_required, sort_order)
  on field.section_title = section.title and section.business_type = 'fve'
on conflict (section_id, field_key) do update set
  label = excluded.label, field_type = excluded.field_type, template_key = excluded.template_key,
  options = excluded.options, is_required = excluded.is_required, is_active = true, sort_order = excluded.sort_order;

update public.crm_opportunity_templates
set description = 'Kompletní EKV šablona FVE podle používaného procesu v Raynetu: kvalifikace, nabídka, technická data, připojení, instalace, revize a předání.',
    default_category = 'FVE MIKROZDROJ',
    custom_fields = custom_fields || jsonb_build_object(
      'pd_type', 'FVE_ZAKLAD', 'ppp_submitted', false, 'production_documentation_approved', false,
      'system_power_kwp', null, 'battery_capacity_kwh', null, 'charger_power_kw', null,
      'string_count', null, 'panel_count', null, 'subsidy_accepted', false,
      'documentation_status', 'chybi'
    ),
    checklist = jsonb_build_array(
      'Ověřit klienta, kontakt a adresu instalace',
      'Doplnit parcelu, katastr a list vlastnictví',
      'Zapsat spotřebu, EAN a parametry připojení',
      'Navrhnout výkon FVE, stringy, střídač a baterii',
      'Prověřit PPP, SOP a dotační podmínky',
      'Naplánovat technickou prohlídku a zapsat zápis',
      'Připravit kalkulaci a odeslat nabídku',
      'Zapsat výsledek jednání a další krok',
      'Po realizaci doplnit sériová čísla a revize',
      'Uzavřít předání a archivaci dokumentace'
    ),
    item_presets = jsonb_build_array(
      jsonb_build_object('group', 'Panely', 'required', true),
      jsonb_build_object('group', 'Střídač a baterie', 'required', true),
      jsonb_build_object('group', 'Konstrukce a elektroinstalace', 'required', true),
      jsonb_build_object('group', 'Projekt, revize a vyřízení', 'required', true)
    ),
    updated_at = now()
where name = 'FVE – standardní obchodní případ';

create table if not exists public.crm_external_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  instance_name text not null,
  display_name text not null,
  status text not null default 'not_tested',
  last_tested_at timestamptz,
  last_inventory jsonb not null default '{}'::jsonb,
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_external_connections_provider_check check (provider in ('raynet')),
  constraint crm_external_connections_status_check check (status in ('not_tested', 'connected', 'error')),
  constraint crm_external_connections_instance_unique unique (provider, instance_name)
);

create table if not exists public.crm_external_user_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
  external_user_id text not null,
  external_email text,
  external_name text,
  member_id uuid references public.members(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_external_user_mappings_unique unique (connection_id, external_user_id)
);

create table if not exists public.crm_external_value_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
  entity_type text not null,
  field_name text not null,
  external_id text not null,
  external_value text,
  target_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_external_value_mappings_field_check check (field_name in ('stage', 'business_type', 'activity_type')),
  constraint crm_external_value_mappings_unique unique (connection_id, entity_type, field_name, external_id)
);

create table if not exists public.crm_import_batches (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
  status text not null default 'preview',
  source_counts jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  mapping_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.members(id) on delete set null,
  approved_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  applied_at timestamptz,
  error_message text,
  constraint crm_import_batches_status_check check (status in ('preview', 'ready', 'applying', 'applied', 'failed'))
);

create table if not exists public.crm_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.crm_import_batches(id) on delete cascade,
  entity_type text not null,
  external_id text not null,
  source_updated_at timestamptz,
  source_hash text not null,
  raw_payload jsonb not null,
  mapped_payload jsonb not null default '{}'::jsonb,
  proposed_action text not null default 'create',
  status text not null default 'staged',
  target_table text,
  target_id uuid,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_import_rows_entity_check check (entity_type in ('company', 'business_case', 'activity')),
  constraint crm_import_rows_action_check check (proposed_action in ('create', 'update', 'skip', 'conflict')),
  constraint crm_import_rows_status_check check (status in ('staged', 'imported', 'skipped', 'conflict', 'failed')),
  constraint crm_import_rows_unique unique (batch_id, entity_type, external_id)
);

create table if not exists public.crm_external_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.crm_external_connections(id) on delete cascade,
  entity_type text not null,
  external_id text not null,
  target_table text not null,
  target_id uuid not null,
  source_updated_at timestamptz,
  source_hash text not null,
  last_imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint crm_external_links_entity_check check (entity_type in ('company', 'business_case', 'activity')),
  constraint crm_external_links_target_check check (target_table in ('subjects', 'crm_opportunities', 'crm_activities')),
  constraint crm_external_links_unique unique (connection_id, entity_type, external_id),
  constraint crm_external_links_target_unique unique (connection_id, target_table, target_id)
);

create index if not exists idx_crm_import_batches_connection_created
  on public.crm_import_batches(connection_id, created_at desc);
create index if not exists idx_crm_import_rows_batch_status
  on public.crm_import_rows(batch_id, status, entity_type);
create index if not exists idx_crm_external_links_lookup
  on public.crm_external_links(connection_id, entity_type, external_id);

drop trigger if exists update_crm_external_connections_updated_at on public.crm_external_connections;
create trigger update_crm_external_connections_updated_at before update on public.crm_external_connections
for each row execute function public.update_crm_updated_at();
drop trigger if exists update_crm_external_user_mappings_updated_at on public.crm_external_user_mappings;
create trigger update_crm_external_user_mappings_updated_at before update on public.crm_external_user_mappings
for each row execute function public.update_crm_updated_at();
drop trigger if exists update_crm_external_value_mappings_updated_at on public.crm_external_value_mappings;
create trigger update_crm_external_value_mappings_updated_at before update on public.crm_external_value_mappings
for each row execute function public.update_crm_updated_at();
drop trigger if exists update_crm_import_rows_updated_at on public.crm_import_rows;
create trigger update_crm_import_rows_updated_at before update on public.crm_import_rows
for each row execute function public.update_crm_updated_at();

alter table public.crm_external_connections enable row level security;
alter table public.crm_external_user_mappings enable row level security;
alter table public.crm_external_value_mappings enable row level security;
alter table public.crm_import_batches enable row level security;
alter table public.crm_import_rows enable row level security;
alter table public.crm_external_links enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'crm_external_connections', 'crm_external_user_mappings', 'crm_external_value_mappings',
    'crm_import_batches', 'crm_import_rows', 'crm_external_links'
  ] loop
    execute format('drop policy if exists "CRM import admin access" on public.%I', table_name);
    execute format($policy$
      create policy "CRM import admin access" on public.%I for all to authenticated
      using (
        public.get_user_role() = 'admin'
        or exists (
          select 1 from public.role_permissions p
          where p.role = public.get_user_role() and p.module = 'crm' and p.can_admin
        )
      )
      with check (
        public.get_user_role() = 'admin'
        or exists (
          select 1 from public.role_permissions p
          where p.role = public.get_user_role() and p.module = 'crm' and p.can_admin
        )
      )
    $policy$, table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end $$;

create or replace function public.apply_raynet_crm_import(p_batch_id uuid, p_actor_member_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.crm_import_batches%rowtype;
  v_row public.crm_import_rows%rowtype;
  v_target_id uuid;
  v_subject_id uuid;
  v_opportunity_id uuid;
  v_owner_id uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_conflicts integer := 0;
  v_payload jsonb;
  v_actor_member_id uuid;
begin
  if auth.uid() is null and coalesce(auth.jwt()->>'role', '') <> 'service_role' then raise exception 'Authentication required'; end if;
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' and public.get_user_role() <> 'admin' and not exists (
    select 1 from public.role_permissions p
    where p.role = public.get_user_role() and p.module = 'crm' and p.can_admin
  ) then raise exception 'CRM administrator permission required'; end if;
  v_actor_member_id := case
    when coalesce(auth.jwt()->>'role', '') = 'service_role' then p_actor_member_id
    else public.get_member_id()
  end;
  if v_actor_member_id is null then raise exception 'Import actor is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 0));
  select * into v_batch from public.crm_import_batches where id = p_batch_id for update;
  if not found then raise exception 'Import batch not found'; end if;
  if v_batch.status = 'applied' then return v_batch.summary; end if;
  if v_batch.status not in ('preview', 'ready', 'failed') then raise exception 'Import batch cannot be applied in state %', v_batch.status; end if;

  update public.crm_import_batches set status = 'applying', approved_by = v_actor_member_id, approved_at = now(), error_message = null
  where id = p_batch_id;

  for v_row in
    select * from public.crm_import_rows where batch_id = p_batch_id
    order by case entity_type when 'company' then 1 when 'business_case' then 2 else 3 end, created_at, external_id
    for update
  loop
    v_payload := v_row.mapped_payload;
    if v_row.proposed_action = 'skip' then
      update public.crm_import_rows set status = 'skipped' where id = v_row.id;
      v_skipped := v_skipped + 1;
      continue;
    elsif v_row.proposed_action = 'conflict' then
      update public.crm_import_rows set status = 'conflict' where id = v_row.id;
      v_conflicts := v_conflicts + 1;
      continue;
    end if;

    select target_id into v_target_id from public.crm_external_links
    where connection_id = v_batch.connection_id and entity_type = v_row.entity_type and external_id = v_row.external_id;

    if v_row.entity_type = 'company' then
      if v_target_id is null and nullif(v_payload->>'ico', '') is not null then
        select id into v_target_id from public.subjects where ico = v_payload->>'ico' limit 1;
      end if;
      if v_target_id is null then
        insert into public.subjects (name, ico, dic, address, email, phone, note, subject_kind, registry_source, registry_snapshot)
        values (
          coalesce(nullif(v_payload->>'name', ''), 'Raynet klient ' || v_row.external_id),
          nullif(v_payload->>'ico', ''), nullif(v_payload->>'dic', ''), nullif(v_payload->>'address', ''),
          nullif(v_payload->>'email', ''), nullif(v_payload->>'phone', ''), nullif(v_payload->>'note', ''),
          case when coalesce((v_payload->>'person')::boolean, false) then 'person' else 'company' end,
          'raynet', v_row.raw_payload
        ) returning id into v_target_id;
        v_created := v_created + 1;
      else
        update public.subjects set
          name = coalesce(nullif(v_payload->>'name', ''), name),
          ico = coalesce(nullif(v_payload->>'ico', ''), ico), dic = coalesce(nullif(v_payload->>'dic', ''), dic),
          address = coalesce(nullif(v_payload->>'address', ''), address), email = coalesce(nullif(v_payload->>'email', ''), email),
          phone = coalesce(nullif(v_payload->>'phone', ''), phone), note = coalesce(nullif(v_payload->>'note', ''), note),
          registry_source = 'raynet', registry_snapshot = v_row.raw_payload, updated_at = now()
        where id = v_target_id;
        v_updated := v_updated + 1;
      end if;
      v_row.target_table := 'subjects';

    elsif v_row.entity_type = 'business_case' then
      select target_id into v_subject_id from public.crm_external_links
      where connection_id = v_batch.connection_id and entity_type = 'company' and external_id = v_payload->>'company_external_id';
      if v_subject_id is null then
        update public.crm_import_rows set status = 'conflict', error_message = 'Klient obchodního případu není namapován.' where id = v_row.id;
        v_conflicts := v_conflicts + 1;
        continue;
      end if;
      select member_id into v_owner_id from public.crm_external_user_mappings
      where connection_id = v_batch.connection_id and external_user_id = v_payload->>'owner_external_id' and is_active;
      if v_target_id is null then
        insert into public.crm_opportunities (
          subject_id, owner_member_id, title, number, stage, status, priority, source, value, probability,
          expected_close_date, description, category, business_type, currency, classification_1, classification_2,
          classification_3, tags, custom_fields, template_id
        ) values (
          v_subject_id, v_owner_id, coalesce(nullif(v_payload->>'title', ''), 'Raynet OP ' || v_row.external_id),
          nullif(v_payload->>'number', ''), coalesce(nullif(v_payload->>'stage', ''), 'lead'),
          coalesce(nullif(v_payload->>'status', ''), 'open'), 'medium', 'Raynet',
          coalesce((v_payload->>'value')::numeric, 0), greatest(0, least(100, coalesce((v_payload->>'probability')::integer, 0))),
          nullif(v_payload->>'expected_close_date', '')::date, nullif(v_payload->>'description', ''),
          nullif(v_payload->>'category', ''), coalesce(nullif(v_payload->>'business_type', ''), 'fve'),
          coalesce(nullif(v_payload->>'currency', ''), 'CZK'), nullif(v_payload->>'classification_1', ''),
          nullif(v_payload->>'classification_2', ''), nullif(v_payload->>'classification_3', ''),
          coalesce(array(select jsonb_array_elements_text(v_payload->'tags')), '{}'::text[]),
          coalesce(v_payload->'custom_fields', '{}'::jsonb) || jsonb_build_object('_raynet', v_row.raw_payload),
          (select id from public.crm_opportunity_templates where business_type = coalesce(nullif(v_payload->>'business_type', ''), 'fve') and is_active order by (name = 'FVE – standardní obchodní případ') desc, updated_at desc limit 1)
        ) returning id into v_target_id;
        v_created := v_created + 1;
      else
        update public.crm_opportunities set
          subject_id = v_subject_id, owner_member_id = coalesce(v_owner_id, owner_member_id),
          title = coalesce(nullif(v_payload->>'title', ''), title), number = coalesce(nullif(v_payload->>'number', ''), number),
          stage = coalesce(nullif(v_payload->>'stage', ''), stage), status = coalesce(nullif(v_payload->>'status', ''), status),
          value = coalesce((v_payload->>'value')::numeric, value),
          probability = greatest(0, least(100, coalesce((v_payload->>'probability')::integer, probability))),
          expected_close_date = coalesce(nullif(v_payload->>'expected_close_date', '')::date, expected_close_date),
          description = coalesce(nullif(v_payload->>'description', ''), description),
          category = coalesce(nullif(v_payload->>'category', ''), category), business_type = coalesce(nullif(v_payload->>'business_type', ''), business_type),
          classification_1 = coalesce(nullif(v_payload->>'classification_1', ''), classification_1),
          classification_2 = coalesce(nullif(v_payload->>'classification_2', ''), classification_2),
          classification_3 = coalesce(nullif(v_payload->>'classification_3', ''), classification_3),
          tags = coalesce(array(select jsonb_array_elements_text(v_payload->'tags')), tags),
          custom_fields = coalesce(custom_fields, '{}'::jsonb) || coalesce(v_payload->'custom_fields', '{}'::jsonb) || jsonb_build_object('_raynet', v_row.raw_payload),
          updated_at = now()
        where id = v_target_id;
        v_updated := v_updated + 1;
      end if;
      v_row.target_table := 'crm_opportunities';

    elsif v_row.entity_type = 'activity' then
      select target_id into v_opportunity_id from public.crm_external_links
      where connection_id = v_batch.connection_id and entity_type = 'business_case' and external_id = v_payload->>'business_case_external_id';
      if v_opportunity_id is null then
        update public.crm_import_rows set status = 'skipped', error_message = 'Aktivita není navázaná na importovaný obchodní případ.' where id = v_row.id;
        v_skipped := v_skipped + 1;
        continue;
      end if;
      select member_id into v_owner_id from public.crm_external_user_mappings
      where connection_id = v_batch.connection_id and external_user_id = v_payload->>'owner_external_id' and is_active;
      if v_target_id is null then
        insert into public.crm_activities (
          opportunity_id, subject_id, assigned_member_id, type, status, title, description, due_at, completed_at,
          starts_at, ends_at, location, outcome, meeting_minutes, created_by_member_id
        ) values (
          v_opportunity_id, (select subject_id from public.crm_opportunities where id = v_opportunity_id), v_owner_id,
          coalesce(nullif(v_payload->>'type', ''), 'note'), coalesce(nullif(v_payload->>'status', ''), 'planned'),
          coalesce(nullif(v_payload->>'title', ''), 'Raynet aktivita ' || v_row.external_id), nullif(v_payload->>'description', ''),
          nullif(v_payload->>'starts_at', '')::timestamptz, nullif(v_payload->>'completed_at', '')::timestamptz,
          nullif(v_payload->>'starts_at', '')::timestamptz, nullif(v_payload->>'ends_at', '')::timestamptz,
          nullif(v_payload->>'location', ''), nullif(v_payload->>'outcome', ''), nullif(v_payload->>'meeting_minutes', ''), v_actor_member_id
        ) returning id into v_target_id;
        v_created := v_created + 1;
      else
        update public.crm_activities set
          assigned_member_id = coalesce(v_owner_id, assigned_member_id), type = coalesce(nullif(v_payload->>'type', ''), type),
          status = coalesce(nullif(v_payload->>'status', ''), status), title = coalesce(nullif(v_payload->>'title', ''), title),
          description = coalesce(nullif(v_payload->>'description', ''), description),
          starts_at = coalesce(nullif(v_payload->>'starts_at', '')::timestamptz, starts_at),
          ends_at = coalesce(nullif(v_payload->>'ends_at', '')::timestamptz, ends_at),
          due_at = coalesce(nullif(v_payload->>'starts_at', '')::timestamptz, due_at),
          completed_at = coalesce(nullif(v_payload->>'completed_at', '')::timestamptz, completed_at),
          location = coalesce(nullif(v_payload->>'location', ''), location), updated_at = now()
        where id = v_target_id;
        v_updated := v_updated + 1;
      end if;
      v_row.target_table := 'crm_activities';
    end if;

    insert into public.crm_external_links (connection_id, entity_type, external_id, target_table, target_id, source_updated_at, source_hash, last_imported_at)
    values (v_batch.connection_id, v_row.entity_type, v_row.external_id, v_row.target_table, v_target_id, v_row.source_updated_at, v_row.source_hash, now())
    on conflict (connection_id, entity_type, external_id) do update set
      target_table = excluded.target_table, target_id = excluded.target_id, source_updated_at = excluded.source_updated_at,
      source_hash = excluded.source_hash, last_imported_at = excluded.last_imported_at;
    update public.crm_import_rows set status = 'imported', target_table = v_row.target_table, target_id = v_target_id, error_message = null where id = v_row.id;
  end loop;

  v_payload := jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped, 'conflicts', v_conflicts);
  update public.crm_import_batches set status = 'applied', applied_at = now(), summary = v_payload where id = p_batch_id;
  return v_payload;
exception when others then
  -- The RPC call is one transaction, so no partial imported CRM records remain.
  raise;
end;
$$;

revoke all on function public.apply_raynet_crm_import(uuid, uuid) from public, anon;
grant execute on function public.apply_raynet_crm_import(uuid, uuid) to authenticated, service_role;

commit;
