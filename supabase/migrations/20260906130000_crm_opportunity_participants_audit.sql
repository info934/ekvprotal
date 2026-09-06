-- Raynet-inspired opportunity participants and immutable change history.

create table if not exists public.crm_opportunity_participants (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  member_id uuid references public.members(id) on delete set null,
  name text not null,
  role text not null default 'stakeholder',
  organization text,
  email text,
  phone text,
  notes text,
  is_primary boolean not null default false,
  created_by_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_opportunity_participants_role_check check (role in (
    'decision_maker', 'technical_contact', 'customer_contact', 'supplier', 'partner', 'advisor', 'observer', 'stakeholder'
  )),
  constraint crm_opportunity_participants_name_check check (length(trim(name)) between 2 and 200)
);

create unique index if not exists crm_opportunity_participants_subject_unique
  on public.crm_opportunity_participants(opportunity_id, subject_id) where subject_id is not null;
create unique index if not exists crm_opportunity_participants_member_unique
  on public.crm_opportunity_participants(opportunity_id, member_id) where member_id is not null;
create index if not exists idx_crm_opportunity_participants_opportunity
  on public.crm_opportunity_participants(opportunity_id, is_primary desc, created_at);

drop trigger if exists update_crm_opportunity_participants_updated_at on public.crm_opportunity_participants;
create trigger update_crm_opportunity_participants_updated_at
before update on public.crm_opportunity_participants
for each row execute function public.update_crm_updated_at();

create table if not exists public.crm_opportunity_events (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null,
  event_type text not null,
  changed_fields jsonb not null default '{}'::jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  actor_member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint crm_opportunity_events_type_check check (event_type in ('created', 'updated', 'deleted', 'imported'))
);

create index if not exists idx_crm_opportunity_events_opportunity_created
  on public.crm_opportunity_events(opportunity_id, created_at desc);

create or replace function public.audit_crm_opportunity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_event_type text;
  v_changed jsonb := '{}'::jsonb;
  v_snapshot jsonb;
begin
  v_id := coalesce(new.id, old.id);
  v_event_type := case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted' else 'updated' end;
  v_snapshot := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
    - array['custom_fields', 'updated_at'];
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(current_row.key, jsonb_build_object('from', previous_row.value, 'to', current_row.value)), '{}'::jsonb)
    into v_changed
    from jsonb_each(to_jsonb(new)) current_row
    join jsonb_each(to_jsonb(old)) previous_row using (key)
    where current_row.key not in ('updated_at', 'custom_fields') and current_row.value is distinct from previous_row.value;
    if coalesce(new.custom_fields, '{}'::jsonb) is distinct from coalesce(old.custom_fields, '{}'::jsonb) then
      v_changed := v_changed || jsonb_build_object('custom_fields', jsonb_build_object('changed', true));
    end if;
  end if;
  insert into public.crm_opportunity_events(opportunity_id, event_type, changed_fields, snapshot, actor_member_id)
  values (v_id, v_event_type, v_changed, v_snapshot, public.get_member_id());
  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_crm_opportunity_change on public.crm_opportunities;
create trigger audit_crm_opportunity_change
after insert or update or delete on public.crm_opportunities
for each row execute function public.audit_crm_opportunity_change();

revoke all on function public.audit_crm_opportunity_change() from public, anon, authenticated;

alter table public.crm_opportunity_participants enable row level security;
alter table public.crm_opportunity_events enable row level security;

drop policy if exists "CRM opportunity participants read access" on public.crm_opportunity_participants;
create policy "CRM opportunity participants read access" on public.crm_opportunity_participants
for select to authenticated using (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'crm' and (p.can_read or p.can_edit or p.can_admin)
  )
);
drop policy if exists "CRM opportunity participants edit access" on public.crm_opportunity_participants;
create policy "CRM opportunity participants edit access" on public.crm_opportunity_participants
for all to authenticated using (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'crm' and (p.can_edit or p.can_admin)
  )
) with check (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'crm' and (p.can_edit or p.can_admin)
  )
);
drop policy if exists "CRM opportunity events read access" on public.crm_opportunity_events;
create policy "CRM opportunity events read access" on public.crm_opportunity_events
for select to authenticated using (
  public.get_user_role() = 'admin' or exists (
    select 1 from public.role_permissions p where p.role = public.get_user_role() and p.module = 'crm' and (p.can_read or p.can_edit or p.can_admin)
  )
);

revoke all on public.crm_opportunity_participants, public.crm_opportunity_events from anon;
grant select, insert, update, delete on public.crm_opportunity_participants to authenticated;
grant select on public.crm_opportunity_events to authenticated;
grant all on public.crm_opportunity_participants, public.crm_opportunity_events to service_role;
