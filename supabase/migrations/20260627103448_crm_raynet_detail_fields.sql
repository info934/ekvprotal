alter table public.crm_opportunities
  add column if not exists category text,
  add column if not exists business_type text,
  add column if not exists currency text not null default 'CZK',
  add column if not exists version_no integer not null default 1,
  add column if not exists classification_1 text,
  add column if not exists classification_2 text,
  add column if not exists classification_3 text,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists confirmation_status text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references public.members(id) on delete set null,
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create index if not exists idx_crm_opportunities_business_type
  on public.crm_opportunities (business_type);

create index if not exists idx_crm_opportunities_category
  on public.crm_opportunities (category);

create table if not exists public.crm_custom_field_sections (
  id uuid primary key default gen_random_uuid(),
  business_type text not null default 'general',
  title text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_custom_field_sections_unique unique (business_type, title)
);

create table if not exists public.crm_custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.crm_custom_field_sections(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null default 'text',
  template_key text,
  options jsonb not null default '[]'::jsonb,
  placeholder text,
  is_required boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_custom_field_definitions_key_unique unique (section_id, field_key),
  constraint crm_custom_field_definitions_type_check check (field_type in ('text', 'textarea', 'number', 'date', 'boolean', 'select', 'url', 'email'))
);

create index if not exists idx_crm_custom_field_sections_active_sort
  on public.crm_custom_field_sections (business_type, is_active, sort_order);

create index if not exists idx_crm_custom_field_definitions_section_sort
  on public.crm_custom_field_definitions (section_id, is_active, sort_order);

drop trigger if exists update_crm_custom_field_sections_updated_at on public.crm_custom_field_sections;
create trigger update_crm_custom_field_sections_updated_at
before update on public.crm_custom_field_sections
for each row execute function public.update_crm_updated_at();

drop trigger if exists update_crm_custom_field_definitions_updated_at on public.crm_custom_field_definitions;
create trigger update_crm_custom_field_definitions_updated_at
before update on public.crm_custom_field_definitions
for each row execute function public.update_crm_updated_at();

alter table public.crm_custom_field_sections enable row level security;
alter table public.crm_custom_field_definitions enable row level security;

drop policy if exists "CRM custom field sections read access" on public.crm_custom_field_sections;
create policy "CRM custom field sections read access"
on public.crm_custom_field_sections
for select
to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module = 'crm'
      and role_permissions.can_read = true
  )
);

drop policy if exists "CRM custom field sections admin access" on public.crm_custom_field_sections;
create policy "CRM custom field sections admin access"
on public.crm_custom_field_sections
for all
to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module = 'crm'
      and role_permissions.can_admin = true
  )
)
with check (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module = 'crm'
      and role_permissions.can_admin = true
  )
);

drop policy if exists "CRM custom field definitions read access" on public.crm_custom_field_definitions;
create policy "CRM custom field definitions read access"
on public.crm_custom_field_definitions
for select
to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module = 'crm'
      and role_permissions.can_read = true
  )
);

drop policy if exists "CRM custom field definitions admin access" on public.crm_custom_field_definitions;
create policy "CRM custom field definitions admin access"
on public.crm_custom_field_definitions
for all
to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module = 'crm'
      and role_permissions.can_admin = true
  )
)
with check (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module = 'crm'
      and role_permissions.can_admin = true
  )
);

insert into public.crm_custom_field_sections (business_type, title, description, sort_order)
values
  ('fve', 'Fakturace', 'Fakturacni a platebni udaje obchodniho pripadu.', 10),
  ('fve', 'SharePoint / API', 'Externi slozky, integrace a identifikatory.', 20),
  ('fve', 'Identifikace nemovitosti', 'Adresa, parcela, distribucni uzemi a napojeni.', 30),
  ('fve', 'Konfigurace FVE', 'Zakladni technicke parametry elektrarny.', 40),
  ('fve', 'Panely', 'Typ, vykon a pocet panelu.', 50),
  ('fve', 'Stridac a baterie', 'Stridac, bateriove uloziste a kapacity.', 60),
  ('fve', 'Dotace', 'Program, stav zadosti a relevantni terminy.', 70),
  ('fve', 'Dokumentace', 'Projektova, revizni a predavaci dokumentace.', 80),
  ('pd', 'Projektova dokumentace', 'Stupen projektu, urady, terminy a odpovednosti.', 10),
  ('hw', 'Hardware', 'Dodavka zarizeni, serializace a servisni informace.', 10),
  ('service', 'Servis', 'Typ zasahu, SLA, termin a vysledek.', 10)
on conflict (business_type, title) do update
set description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = true;

insert into public.crm_custom_field_definitions (section_id, field_key, label, field_type, template_key, options, sort_order)
select section.id, defaults.field_key, defaults.label, defaults.field_type, defaults.template_key, defaults.options::jsonb, defaults.sort_order
from public.crm_custom_field_sections section
join (
  values
    ('fve', 'Fakturace', 'invoice_mode', 'Rezim fakturace', 'select', 'invoice_mode', '["zaloha","po etapach","po predani"]', 10),
    ('fve', 'SharePoint / API', 'sharepoint_folder', 'SharePoint slozka', 'url', 'sharepoint_folder', '[]', 10),
    ('fve', 'Identifikace nemovitosti', 'installation_address', 'Adresa instalace', 'textarea', 'installation_address', '[]', 10),
    ('fve', 'Identifikace nemovitosti', 'parcel_number', 'Parcelni cislo', 'text', 'parcel_number', '[]', 20),
    ('fve', 'Konfigurace FVE', 'system_power_kwp', 'Vykon FVE kWp', 'number', 'system_power_kwp', '[]', 10),
    ('fve', 'Panely', 'panel_count', 'Pocet panelu', 'number', 'panel_count', '[]', 10),
    ('fve', 'Panely', 'panel_type', 'Typ panelu', 'text', 'panel_type', '[]', 20),
    ('fve', 'Stridac a baterie', 'inverter_type', 'Typ stridace', 'text', 'inverter_type', '[]', 10),
    ('fve', 'Stridac a baterie', 'battery_capacity_kwh', 'Kapacita baterie kWh', 'number', 'battery_capacity_kwh', '[]', 20),
    ('fve', 'Dotace', 'subsidy_status', 'Stav dotace', 'select', 'subsidy_status', '["neresi se","priprava","podano","schvaleno","vyplaceno"]', 10),
    ('fve', 'Dokumentace', 'documentation_status', 'Stav dokumentace', 'select', 'documentation_status', '["chybi","rozpracovano","kompletni"]', 10),
    ('pd', 'Projektova dokumentace', 'project_stage', 'Stupen dokumentace', 'select', 'project_stage', '["studie","DSP","DPS","realizacni dokumentace"]', 10),
    ('hw', 'Hardware', 'delivery_scope', 'Rozsah dodavky', 'textarea', 'delivery_scope', '[]', 10),
    ('service', 'Servis', 'service_type', 'Typ servisu', 'select', 'service_type', '["diagnostika","oprava","revize","zasah SLA"]', 10)
) as defaults(business_type, section_title, field_key, label, field_type, template_key, options, sort_order)
  on defaults.business_type = section.business_type
 and defaults.section_title = section.title
on conflict (section_id, field_key) do update
set label = excluded.label,
    field_type = excluded.field_type,
    template_key = excluded.template_key,
    options = excluded.options,
    sort_order = excluded.sort_order,
    is_active = true;
