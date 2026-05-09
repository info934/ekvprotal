create table if not exists public.crm_opportunity_items (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  catalog_item_id uuid null references public.commercial_item_catalog(id) on delete set null,
  code text null,
  name text not null,
  description text null,
  quantity numeric not null default 1,
  unit text not null default 'ks',
  unit_price numeric not null default 0,
  discount_percent numeric not null default 0,
  vat_rate numeric not null default 21,
  line_total numeric not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_opportunity_items enable row level security;

drop policy if exists "CRM opportunity items read access" on public.crm_opportunity_items;
create policy "CRM opportunity items read access"
  on public.crm_opportunity_items
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

drop policy if exists "CRM opportunity items edit access" on public.crm_opportunity_items;
create policy "CRM opportunity items edit access"
  on public.crm_opportunity_items
  for all
  to authenticated
  using (
    get_user_role() = 'admin'
    or exists (
      select 1 from public.role_permissions
      where role_permissions.role = get_user_role()
        and role_permissions.module = 'crm'
        and (role_permissions.can_edit = true or role_permissions.can_admin = true)
    )
  )
  with check (
    get_user_role() = 'admin'
    or exists (
      select 1 from public.role_permissions
      where role_permissions.role = get_user_role()
        and role_permissions.module = 'crm'
        and (role_permissions.can_edit = true or role_permissions.can_admin = true)
    )
  );

create index if not exists crm_opportunity_items_opportunity_idx on public.crm_opportunity_items(opportunity_id, sort_order);

insert into public.crm_opportunity_items (
  opportunity_id, catalog_item_id, code, name, description, quantity, unit, unit_price, discount_percent, vat_rate, line_total, sort_order
)
select distinct on (d.opportunity_id, i.sort_order, i.name)
  d.opportunity_id,
  i.catalog_item_id,
  i.code,
  i.name,
  i.description,
  i.quantity,
  i.unit,
  i.unit_price,
  i.discount_percent,
  i.vat_rate,
  i.line_total,
  i.sort_order
from public.crm_commercial_documents d
join public.crm_commercial_document_items i on i.document_id = d.id
where coalesce(d.sync_items, true) = true
  and not exists (
    select 1 from public.crm_opportunity_items existing
    where existing.opportunity_id = d.opportunity_id
  )
order by d.opportunity_id, i.sort_order, i.name, d.created_at asc;
