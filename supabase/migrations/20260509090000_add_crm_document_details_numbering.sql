alter table public.crm_opportunities
  add column if not exists number text;

alter table public.crm_commercial_documents
  add column if not exists sync_items boolean not null default true;

create table if not exists public.crm_numbering_settings (
  document_type text primary key,
  prefix text not null,
  next_number integer not null default 1,
  padding integer not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_numbering_settings enable row level security;

drop policy if exists "CRM numbering settings read access" on public.crm_numbering_settings;
create policy "CRM numbering settings read access"
  on public.crm_numbering_settings
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

drop policy if exists "CRM numbering settings admin access" on public.crm_numbering_settings;
create policy "CRM numbering settings admin access"
  on public.crm_numbering_settings
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

insert into public.crm_numbering_settings (document_type, prefix, next_number, padding)
values
  ('opportunity', 'OP', 1, 3),
  ('offer', 'NAB', 1, 3),
  ('order', 'OBJ', 1, 3)
on conflict (document_type) do nothing;

create index if not exists crm_opportunities_number_idx on public.crm_opportunities(number);
create index if not exists crm_commercial_documents_type_number_idx on public.crm_commercial_documents(type, number);
