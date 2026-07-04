create table if not exists public.product_sets (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  description text,
  category text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_sets_code_unique unique (code)
);

create table if not exists public.product_set_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.product_sets(id) on delete cascade,
  catalog_item_id uuid not null references public.commercial_item_catalog(id) on delete restrict,
  quantity numeric(14, 3) not null default 1,
  sort_order integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_set_items_quantity_check check (quantity > 0),
  constraint product_set_items_unique unique (set_id, catalog_item_id)
);

create index if not exists idx_product_sets_active_category
  on public.product_sets (is_active, category, name);

create index if not exists idx_product_set_items_set
  on public.product_set_items (set_id, sort_order);

create index if not exists idx_product_set_items_catalog_item
  on public.product_set_items (catalog_item_id);

drop trigger if exists update_product_sets_updated_at on public.product_sets;
create trigger update_product_sets_updated_at
before update on public.product_sets
for each row execute function public.update_crm_updated_at();

drop trigger if exists update_product_set_items_updated_at on public.product_set_items;
create trigger update_product_set_items_updated_at
before update on public.product_set_items
for each row execute function public.update_crm_updated_at();

alter table public.product_sets enable row level security;
alter table public.product_set_items enable row level security;

drop policy if exists "Product sets read access" on public.product_sets;
create policy "Product sets read access"
on public.product_sets
for select
to authenticated
using (
  public.get_user_role() = 'admin'
  or exists (
    select 1
    from public.role_permissions rp
    where rp.role = public.get_user_role()
      and rp.module in ('crm', 'realizace', 'projects', 'settings')
      and rp.can_read = true
  )
);

drop policy if exists "Product sets edit access" on public.product_sets;
create policy "Product sets edit access"
on public.product_sets
for all
to authenticated
using (
  public.get_user_role() = 'admin'
  or exists (
    select 1
    from public.role_permissions rp
    where rp.role = public.get_user_role()
      and rp.module in ('crm', 'settings')
      and (rp.can_edit = true or rp.can_admin = true)
  )
)
with check (
  public.get_user_role() = 'admin'
  or exists (
    select 1
    from public.role_permissions rp
    where rp.role = public.get_user_role()
      and rp.module in ('crm', 'settings')
      and (rp.can_edit = true or rp.can_admin = true)
  )
);

drop policy if exists "Product set items read access" on public.product_set_items;
create policy "Product set items read access"
on public.product_set_items
for select
to authenticated
using (
  public.get_user_role() = 'admin'
  or exists (
    select 1
    from public.role_permissions rp
    where rp.role = public.get_user_role()
      and rp.module in ('crm', 'realizace', 'projects', 'settings')
      and rp.can_read = true
  )
);

drop policy if exists "Product set items edit access" on public.product_set_items;
create policy "Product set items edit access"
on public.product_set_items
for all
to authenticated
using (
  public.get_user_role() = 'admin'
  or exists (
    select 1
    from public.role_permissions rp
    where rp.role = public.get_user_role()
      and rp.module in ('crm', 'settings')
      and (rp.can_edit = true or rp.can_admin = true)
  )
)
with check (
  public.get_user_role() = 'admin'
  or exists (
    select 1
    from public.role_permissions rp
    where rp.role = public.get_user_role()
      and rp.module in ('crm', 'settings')
      and (rp.can_edit = true or rp.can_admin = true)
  )
);

create or replace view public.product_usage_stats
with (security_invoker = true)
as
select
  catalog_item_id,
  count(*)::integer as total_usage_count,
  count(*) filter (where source_type = 'opportunity')::integer as opportunity_usage_count,
  count(*) filter (where source_type = 'commercial_document')::integer as commercial_document_usage_count,
  max(created_at) as last_used_at
from (
  select
    catalog_item_id,
    created_at,
    'opportunity'::text as source_type
  from public.crm_opportunity_items
  where catalog_item_id is not null

  union all

  select
    catalog_item_id,
    created_at,
    'commercial_document'::text as source_type
  from public.crm_commercial_document_items
  where catalog_item_id is not null
) usage_rows
group by catalog_item_id;

grant select on public.product_usage_stats to authenticated;
