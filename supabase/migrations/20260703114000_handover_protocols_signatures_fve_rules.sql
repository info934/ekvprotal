
-- Handover protocols, signatures, document template categories and simple FVE offer rules.

alter table public.order_templates
  add column if not exists document_category text not null default 'generic';

alter table public.order_templates
  drop constraint if exists order_templates_document_category_check;

alter table public.order_templates
  add constraint order_templates_document_category_check
  check (document_category in ('generic', 'offer', 'order', 'contract', 'handover_full', 'handover_partial', 'service_protocol'));

create index if not exists idx_order_templates_document_category
  on public.order_templates (document_category, is_active);

insert into public.crm_numbering_settings (document_type, prefix, next_number, padding, year_format)
values
  ('handover_full', 'PP', 1, 3, 'YY'),
  ('handover_partial', 'CPP', 1, 3, 'YY'),
  ('service_protocol', 'SP', 1, 3, 'YY'),
  ('contract', 'SML', 1, 3, 'YY')
on conflict (document_type) do nothing;

create table if not exists public.handover_protocols (
  id uuid primary key default gen_random_uuid(),
  document_type text not null default 'handover_full',
  status text not null default 'draft',
  number text,
  title text not null,
  project_id uuid references public.projects(id) on delete set null,
  realizace_id uuid references public.realizace(id) on delete set null,
  opportunity_id uuid references public.crm_opportunities(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  handover_scope text,
  service_description text,
  notes text,
  signature_provider text not null default 'internal',
  signed_document_hash text,
  final_document_url text,
  locked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handover_protocols_document_type_check check (document_type in ('handover_full', 'handover_partial', 'service_protocol', 'contract')),
  constraint handover_protocols_status_check check (status in ('draft', 'ready_for_signature', 'signed', 'cancelled', 'archived')),
  constraint handover_protocols_signature_provider_check check (signature_provider in ('internal', 'external')),
  constraint handover_protocols_target_check check (project_id is not null or realizace_id is not null or opportunity_id is not null)
);

create table if not exists public.handover_protocol_items (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.handover_protocols(id) on delete cascade,
  catalog_item_id uuid references public.commercial_item_catalog(id) on delete set null,
  code text,
  name text not null,
  description text,
  quantity numeric(14, 3) not null default 1,
  unit text not null default 'ks',
  condition_note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.handover_protocol_defects (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.handover_protocols(id) on delete cascade,
  title text not null,
  description text,
  severity text not null default 'minor',
  responsible_party text,
  due_date date,
  status text not null default 'open',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handover_protocol_defects_severity_check check (severity in ('minor', 'major', 'blocking')),
  constraint handover_protocol_defects_status_check check (status in ('open', 'in_progress', 'resolved', 'accepted'))
);

create table if not exists public.document_signatures (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid references public.handover_protocols(id) on delete cascade,
  commercial_document_id uuid references public.crm_commercial_documents(id) on delete cascade,
  signer_name text not null,
  signer_role text,
  signer_email text,
  signature_type text not null default 'internal',
  signature_data_url text,
  signed_document_hash text,
  ip_address text,
  user_agent text,
  signed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint document_signatures_target_check check (protocol_id is not null or commercial_document_id is not null),
  constraint document_signatures_signature_type_check check (signature_type in ('internal', 'external'))
);

create table if not exists public.fve_offer_rule_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  min_power_kwp numeric(10, 2),
  max_power_kwp numeric(10, 2),
  min_battery_kwh numeric(10, 2),
  max_battery_kwh numeric(10, 2),
  roof_type text,
  customer_type text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fve_offer_rule_items (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.fve_offer_rule_sets(id) on delete cascade,
  catalog_item_id uuid references public.commercial_item_catalog(id) on delete set null,
  item_role text not null default 'service',
  code text,
  name text not null,
  description text,
  unit text not null default 'ks',
  quantity_mode text not null default 'fixed',
  quantity_value numeric(14, 3) not null default 1,
  unit_price_override numeric(14, 2),
  unit_cost_override numeric(14, 2),
  vat_rate numeric(5, 2) not null default 21,
  discount_percent numeric(6, 2) not null default 0,
  is_optional boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fve_offer_rule_items_quantity_mode_check check (quantity_mode in ('fixed', 'per_kwp', 'per_battery_kwh', 'panel_count'))
);

create index if not exists idx_handover_protocols_project on public.handover_protocols(project_id, created_at desc);
create index if not exists idx_handover_protocols_realizace on public.handover_protocols(realizace_id, created_at desc);
create index if not exists idx_handover_protocols_opportunity on public.handover_protocols(opportunity_id, created_at desc);
create index if not exists idx_handover_protocols_type_number on public.handover_protocols(document_type, number);
create index if not exists idx_handover_protocol_items_protocol on public.handover_protocol_items(protocol_id, sort_order);
create index if not exists idx_handover_protocol_defects_protocol on public.handover_protocol_defects(protocol_id, sort_order);
create index if not exists idx_document_signatures_protocol on public.document_signatures(protocol_id, signed_at desc);
create index if not exists idx_fve_offer_rule_sets_active on public.fve_offer_rule_sets(is_active, sort_order);
create index if not exists idx_fve_offer_rule_items_set on public.fve_offer_rule_items(rule_set_id, sort_order);

alter table public.handover_protocols enable row level security;
alter table public.handover_protocol_items enable row level security;
alter table public.handover_protocol_defects enable row level security;
alter table public.document_signatures enable row level security;
alter table public.fve_offer_rule_sets enable row level security;
alter table public.fve_offer_rule_items enable row level security;

-- Updated-at triggers use the existing project helper.
drop trigger if exists update_handover_protocols_updated_at on public.handover_protocols;
create trigger update_handover_protocols_updated_at before update on public.handover_protocols
for each row execute function public.update_crm_updated_at();

drop trigger if exists update_handover_protocol_items_updated_at on public.handover_protocol_items;
create trigger update_handover_protocol_items_updated_at before update on public.handover_protocol_items
for each row execute function public.update_crm_updated_at();

drop trigger if exists update_handover_protocol_defects_updated_at on public.handover_protocol_defects;
create trigger update_handover_protocol_defects_updated_at before update on public.handover_protocol_defects
for each row execute function public.update_crm_updated_at();

drop trigger if exists update_fve_offer_rule_sets_updated_at on public.fve_offer_rule_sets;
create trigger update_fve_offer_rule_sets_updated_at before update on public.fve_offer_rule_sets
for each row execute function public.update_crm_updated_at();

drop trigger if exists update_fve_offer_rule_items_updated_at on public.fve_offer_rule_items;
create trigger update_fve_offer_rule_items_updated_at before update on public.fve_offer_rule_items
for each row execute function public.update_crm_updated_at();

-- RLS policies.
drop policy if exists "Handover protocols read access" on public.handover_protocols;
create policy "Handover protocols read access" on public.handover_protocols
for select to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('projects', 'realizace', 'documents', 'crm')
      and role_permissions.can_read = true
  )
);

drop policy if exists "Handover protocols edit access" on public.handover_protocols;
create policy "Handover protocols edit access" on public.handover_protocols
for all to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('projects', 'realizace', 'documents')
      and (role_permissions.can_edit = true or role_permissions.can_admin = true)
  )
)
with check (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('projects', 'realizace', 'documents')
      and (role_permissions.can_edit = true or role_permissions.can_admin = true)
  )
);

drop policy if exists "Handover protocol items read access" on public.handover_protocol_items;
create policy "Handover protocol items read access" on public.handover_protocol_items
for select to authenticated
using (exists (select 1 from public.handover_protocols p where p.id = protocol_id));

drop policy if exists "Handover protocol items edit access" on public.handover_protocol_items;
create policy "Handover protocol items edit access" on public.handover_protocol_items
for all to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('projects', 'realizace', 'documents')
      and (role_permissions.can_edit = true or role_permissions.can_admin = true)
  )
)
with check (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('projects', 'realizace', 'documents')
      and (role_permissions.can_edit = true or role_permissions.can_admin = true)
  )
);

drop policy if exists "Handover protocol defects read access" on public.handover_protocol_defects;
create policy "Handover protocol defects read access" on public.handover_protocol_defects
for select to authenticated
using (exists (select 1 from public.handover_protocols p where p.id = protocol_id));

drop policy if exists "Handover protocol defects edit access" on public.handover_protocol_defects;
create policy "Handover protocol defects edit access" on public.handover_protocol_defects
for all to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('projects', 'realizace', 'documents')
      and (role_permissions.can_edit = true or role_permissions.can_admin = true)
  )
)
with check (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('projects', 'realizace', 'documents')
      and (role_permissions.can_edit = true or role_permissions.can_admin = true)
  )
);

drop policy if exists "Document signatures read access" on public.document_signatures;
create policy "Document signatures read access" on public.document_signatures
for select to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('projects', 'realizace', 'documents', 'crm')
      and role_permissions.can_read = true
  )
);

drop policy if exists "Document signatures insert access" on public.document_signatures;
create policy "Document signatures insert access" on public.document_signatures
for insert to authenticated
with check (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('projects', 'realizace', 'documents')
      and (role_permissions.can_edit = true or role_permissions.can_admin = true)
  )
);

drop policy if exists "FVE offer rule sets read access" on public.fve_offer_rule_sets;
create policy "FVE offer rule sets read access" on public.fve_offer_rule_sets
for select to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('crm', 'settings')
      and role_permissions.can_read = true
  )
);

drop policy if exists "FVE offer rule sets admin access" on public.fve_offer_rule_sets;
create policy "FVE offer rule sets admin access" on public.fve_offer_rule_sets
for all to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('crm', 'settings')
      and role_permissions.can_admin = true
  )
)
with check (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('crm', 'settings')
      and role_permissions.can_admin = true
  )
);

drop policy if exists "FVE offer rule items read access" on public.fve_offer_rule_items;
create policy "FVE offer rule items read access" on public.fve_offer_rule_items
for select to authenticated
using (exists (select 1 from public.fve_offer_rule_sets s where s.id = rule_set_id));

drop policy if exists "FVE offer rule items admin access" on public.fve_offer_rule_items;
create policy "FVE offer rule items admin access" on public.fve_offer_rule_items
for all to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('crm', 'settings')
      and role_permissions.can_admin = true
  )
)
with check (
  get_user_role() = 'admin'
  or exists (
    select 1 from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('crm', 'settings')
      and role_permissions.can_admin = true
  )
);

grant select, insert, update, delete on public.handover_protocols to authenticated;
grant select, insert, update, delete on public.handover_protocol_items to authenticated;
grant select, insert, update, delete on public.handover_protocol_defects to authenticated;
grant select, insert on public.document_signatures to authenticated;
grant select, insert, update, delete on public.fve_offer_rule_sets to authenticated;
grant select, insert, update, delete on public.fve_offer_rule_items to authenticated;

-- Starter rule set and templates. These are intentionally simple and editable in settings later.
insert into public.fve_offer_rule_sets (name, description, is_active, min_power_kwp, max_power_kwp, min_battery_kwh, max_battery_kwh, sort_order)
values ('FVE standard 3-12 kWp', 'Vychozi pravidlova sada pro jednoduche FVE nabidky.', true, 3, 12, 0, 30, 10)
on conflict do nothing;

insert into public.fve_offer_rule_items (rule_set_id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, sort_order)
select s.id, item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, sort_order
from public.fve_offer_rule_sets s
cross join (values
  ('panel', 'FVE-PANEL', 'Fotovoltaicke panely', 'Automaticky odhad podle vykonu FVE.', 'ks', 'panel_count', 1, 2600, 2100, 21, 10),
  ('inverter', 'FVE-INV', 'Stridac FVE', 'Dimenzovany podle zadaneho vykonu.', 'ks', 'fixed', 1, 39000, 30000, 21, 20),
  ('battery', 'FVE-BAT', 'Bateriove uloziste', 'Kapacita dle zadani v kWh.', 'kWh', 'per_battery_kwh', 1, 8500, 6900, 21, 30),
  ('mounting', 'FVE-MNT', 'Montazni konstrukce a kabelaz', 'Konstrukce, kabelaz a instalacni material.', 'kWp', 'per_kwp', 1, 4200, 2800, 21, 40),
  ('service', 'FVE-INST', 'Instalace a uvedeni do provozu', 'Montaz, zapojeni, revize a predani.', 'kWp', 'per_kwp', 1, 6900, 4200, 21, 50),
  ('documentation', 'FVE-DOC', 'Projektova dokumentace a administrativa', 'Zakladni dokumentace, revize a predavaci podklady.', 'ks', 'fixed', 1, 12500, 6500, 21, 60)
) as seed(item_role, code, name, description, unit, quantity_mode, quantity_value, unit_price_override, unit_cost_override, vat_rate, sort_order)
where s.name = 'FVE standard 3-12 kWp'
  and not exists (select 1 from public.fve_offer_rule_items existing where existing.rule_set_id = s.id);

insert into public.order_templates (name, description, document_category, content, is_active)
values
  ('Predavaci protokol - celkovy', 'Vychozi sablona pro celkove predani realizace.', 'handover_full', '<h1>Predavaci protokol {document_number}</h1><p>Klient: {client_name}</p><p>Projekt: {project_name}</p><p>Realizace: {realization_name}</p><h2>Rozsah predani</h2><p>{handover_scope}</p><h2>Predane polozky</h2>{items_table}<h2>Vady a nedodelky</h2>{defects_table}<h2>Podpisy</h2>{signatures_table}', true),
  ('Predavaci protokol - castecny', 'Vychozi sablona pro castecne predani.', 'handover_partial', '<h1>Castecny predavaci protokol {document_number}</h1><p>Klient: {client_name}</p><p>Projekt: {project_name}</p><h2>Predavana cast</h2><p>{handover_scope}</p>{items_table}{defects_table}{signatures_table}', true),
  ('Servisni protokol', 'Vychozi sablona servisniho zasahu.', 'service_protocol', '<h1>Servisni protokol {document_number}</h1><p>Klient: {client_name}</p><p>Projekt: {project_name}</p><h2>Popis servisniho zasahu</h2><p>{service_description}</p><h2>Polozky</h2>{items_table}<h2>Podpisy</h2>{signatures_table}', true),
  ('Smlouva', 'Vychozi jednoducha smluvni sablona.', 'contract', '<h1>Smlouva {document_number}</h1><p>Klient: {client_name}</p><p>Projekt: {project_name}</p><p>{handover_scope}</p><h2>Polozky / predmet smlouvy</h2>{items_table}<h2>Podpisy</h2>{signatures_table}', true)
on conflict do nothing;
