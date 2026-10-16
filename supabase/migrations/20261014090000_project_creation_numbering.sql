begin;

-- The restored materialized view starts WITH NO DATA. Its first refresh must
-- be non-concurrent; subsequent refreshes retain the existing read behavior.
create or replace function public.refresh_user_rewards()
returns void language plpgsql security definer set search_path = public
as $$
begin
  if (select relispopulated from pg_catalog.pg_class where oid = 'public.mv_user_project_rewards'::regclass) then
    refresh materialized view concurrently public.mv_user_project_rewards;
  else
    refresh materialized view public.mv_user_project_rewards;
  end if;
end;
$$;

alter table public.project_types add column if not exists code_prefix text not null default 'PR';
alter table public.project_types drop constraint if exists project_types_code_prefix_check;
alter table public.project_types add constraint project_types_code_prefix_check
  check (code_prefix ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');

create table if not exists public.job_number_sequences (
  kind text not null check (kind in ('project', 'opportunity')),
  prefix text not null,
  year integer not null,
  last_number bigint not null default 0 check (last_number between 0 and 999999999999),
  primary key (kind, prefix, year)
);
alter table public.job_number_sequences enable row level security;
revoke all on public.job_number_sequences from public, anon, authenticated;

create or replace function public.save_project_type(p_name text, p_code_prefix text, p_type_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_type public.project_types;
begin
  if auth.uid() is null or not coalesce((public.can_edit_module('projects') or public.can_edit_crm()), false) then
    raise exception 'Not allowed to manage project types' using errcode = '42501';
  end if;
  p_name := trim(p_name);
  p_code_prefix := upper(trim(p_code_prefix));
  if p_name is null or p_name = '' or length(p_name) > 100 then raise exception 'Zadejte název typu projektu (max. 100 znaků).'; end if;
  if p_code_prefix is null or p_code_prefix !~ '^[A-Z0-9][A-Z0-9_-]{0,19}$' then raise exception 'Neplatný prefix projektu.'; end if;
  if p_type_id is null then
    insert into public.project_types(name, code_prefix) values(p_name, p_code_prefix) returning * into v_type;
  else
    -- Prefix changes never rename a type used as a historical project label.
    update public.project_types set code_prefix = p_code_prefix where id = p_type_id and name = p_name returning * into v_type;
    if v_type.id is null then raise exception 'Typ projektu nebyl nalezen. Obnovte formulář.'; end if;
  end if;
  return to_jsonb(v_type);
end;
$$;

create or replace function public.project_code_prefix(p_project_type text)
returns text language sql stable security definer set search_path = public
as $$
  select coalesce((select code_prefix from public.project_types where name = p_project_type), 'PR');
$$;

create or replace function public.next_job_sequence(p_prefix text, p_year integer, p_kind text)
returns bigint language sql volatile security definer set search_path = public
as $$
  select greatest(
    coalesce((select last_number from public.job_number_sequences where kind = p_kind and prefix = p_prefix and year = p_year), 0),
    coalesce((select max(substring(trim(code) from length(p_prefix) + 5)::bigint)
      from (select code from public.projects where p_kind = 'project'
            union all select number from public.crm_opportunities where p_kind = 'opportunity') existing_codes
      where left(trim(code), length(p_prefix) + 4) = p_prefix || '-' || right(p_year::text, 2) || '-'
        and substring(trim(code) from length(p_prefix) + 5) ~ '^[0-9]{1,12}$'), 0)
  ) + 1;
$$;

create or replace function public.preview_project_code(p_project_type text default null)
returns text language plpgsql stable security definer set search_path = public
as $$
declare
  v_prefix text := public.project_code_prefix(p_project_type);
  v_year integer := extract(year from current_date);
  v_next bigint;
begin
  if auth.uid() is null or not coalesce((public.can_edit_module('projects') or public.can_edit_crm()), false) then
    raise exception 'Not allowed to preview project numbers' using errcode = '42501';
  end if;
  v_next := public.next_job_sequence(v_prefix, v_year, 'project');
  return v_prefix || '-' || to_char(current_date, 'YY') || '-' || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
end;
$$;

create or replace function public.assign_project_code()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_prefix text;
  v_year integer := extract(year from current_date);
  v_next bigint;
begin
  if tg_op = 'UPDATE' and new.code is not distinct from old.code then return new; end if;
  if nullif(trim(new.code), '') is null then
    if tg_op = 'UPDATE' then raise exception 'Kód existujícího projektu nelze vymazat.'; end if;
    v_prefix := public.project_code_prefix(new.type);
    -- Shared prefixes share one counter. The lock lives until the project
    -- transaction commits, including batch creation and failed inserts.
    perform pg_advisory_xact_lock(hashtextextended('project-series:' || v_prefix || ':' || v_year, 0));
    v_next := public.next_job_sequence(v_prefix, v_year, 'project');
    insert into public.job_number_sequences(kind, prefix, year, last_number)
      values('project', v_prefix, v_year, v_next)
      on conflict(kind, prefix, year) do update set last_number = excluded.last_number;
    new.code := v_prefix || '-' || to_char(current_date, 'YY') || '-' || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
  else
    new.code := trim(new.code);
  end if;
  -- Also serialize manual codes so another insert cannot claim the number
  -- between the preview and save. Do not rewrite legacy duplicate records.
  perform pg_advisory_xact_lock(hashtextextended('project-code:' || lower(new.code), 0));
  if exists(select 1 from public.projects p where lower(trim(p.code)) = lower(new.code) and p.id <> new.id) then
    raise exception 'Kód projektu % již existuje. Zvolte jiné číslo nebo automatické číslování.', new.code using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists assign_project_code on public.projects;
create trigger assign_project_code before insert or update of code on public.projects
  for each row execute function public.assign_project_code();

-- A lead can be recorded before the client is known. Downstream documents
-- retain their own required customer and billing validation.
alter table public.crm_opportunities alter column subject_id drop not null;
alter table public.crm_opportunities add column if not exists project_type text;

create or replace function public.preview_crm_opportunity_number(p_project_type text default null)
returns text language plpgsql stable security definer set search_path = public
as $$
declare
  v_prefix text;
  v_next bigint;
  v_setting public.crm_numbering_settings;
begin
  if auth.uid() is null or not coalesce(public.can_edit_crm(), false) then
    raise exception 'Not allowed to preview opportunity numbers' using errcode = '42501';
  end if;
  select * into v_setting from public.crm_numbering_settings where document_type = 'opportunity';
  if nullif(trim(p_project_type), '') is null then
    v_next := coalesce(v_setting.next_number, 1);
    loop
      v_prefix := concat_ws('-', coalesce(v_setting.prefix, 'OP'),
        case coalesce(v_setting.year_format, 'YY') when 'NONE' then null when 'YYYY' then to_char(current_date, 'YYYY') else to_char(current_date, 'YY') end,
        lpad(v_next::text, greatest(2, coalesce(v_setting.padding, 3), length(v_next::text)), '0'));
      exit when not exists(select 1 from public.crm_opportunities where lower(number) = lower(v_prefix));
      v_next := v_next + 1;
    end loop;
    return v_prefix;
  end if;
  v_prefix := coalesce(v_setting.prefix, 'OP') || '-' || public.project_code_prefix(p_project_type);
  v_next := public.next_job_sequence(v_prefix, extract(year from current_date)::integer, 'opportunity');
  return v_prefix || '-' || to_char(current_date, 'YY') || '-' || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
end;
$$;

-- Number allocation and insertion are one transaction. Failed saves do not
-- consume a number, and the security-definer API checks the existing CRM ACL.
create or replace function public.create_crm_opportunity_simple(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_opportunity public.crm_opportunities;
  v_prefix text;
  v_year integer := extract(year from current_date);
  v_next bigint;
  v_number text;
  v_stage text := coalesce(nullif(p_payload->>'stage', ''), 'lead');
  v_project_type text := nullif(trim(p_payload->>'project_type'), '');
begin
  if auth.uid() is null or not coalesce(public.can_edit_crm(), false) then
    raise exception 'Not allowed to create opportunity' using errcode = '42501';
  end if;
  if nullif(trim(p_payload->>'title'), '') is null then raise exception 'Název obchodního případu je povinný.'; end if;
  if v_stage = 'lost' and nullif(trim(p_payload->>'lost_reason'), '') is null then raise exception 'Doplňte důvod prohry.'; end if;
  if coalesce((p_payload->>'value')::numeric, 0) < 0 then raise exception 'Hodnota OP nesmí být záporná.'; end if;
  if v_project_type is null then
    insert into public.crm_numbering_settings(document_type, prefix, next_number, padding, year_format)
      values('opportunity', 'OP', 1, 3, 'YY') on conflict(document_type) do nothing;
    -- Keep the configured legacy series when no project type is selected.
    -- Hold its existing row lock through insertion, and skip imported codes.
    perform 1 from public.crm_numbering_settings where document_type = 'opportunity' for update;
    v_number := public.preview_crm_opportunity_number(null);
    update public.crm_numbering_settings
      set next_number = substring(v_number from '[0-9]+$')::bigint + 1, updated_at = now()
      where document_type = 'opportunity';
  else
    select coalesce(prefix, 'OP') into v_prefix from public.crm_numbering_settings where document_type = 'opportunity';
    v_prefix := coalesce(v_prefix, 'OP') || '-' || public.project_code_prefix(v_project_type);
    perform pg_advisory_xact_lock(hashtextextended('opportunity-series:' || v_prefix || ':' || v_year, 0));
    v_next := public.next_job_sequence(v_prefix, v_year, 'opportunity');
    insert into public.job_number_sequences(kind, prefix, year, last_number)
      values('opportunity', v_prefix, v_year, v_next)
      on conflict(kind, prefix, year) do update set last_number = excluded.last_number;
    v_number := v_prefix || '-' || to_char(current_date, 'YY') || '-' || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
  end if;
  insert into public.crm_opportunities(
    number, title, subject_id, project_id, project_type, owner_member_id,
    stage, status, priority, value, probability, expected_close_date,
    next_step, description, lost_reason, lost_at, template_id, business_type, category, custom_fields
  ) values (
    v_number, trim(p_payload->>'title'), nullif(p_payload->>'subject_id', '')::uuid,
    nullif(p_payload->>'project_id', '')::uuid, v_project_type, public.get_member_id(),
    v_stage, coalesce(nullif(p_payload->>'status', ''), 'open'), coalesce(nullif(p_payload->>'priority', ''), 'medium'),
    coalesce((p_payload->>'value')::numeric, 0), coalesce((p_payload->>'probability')::integer, 10),
    nullif(p_payload->>'expected_close_date', '')::date, nullif(trim(p_payload->>'next_step'), ''), nullif(trim(p_payload->>'description'), ''),
    case when v_stage = 'lost' then trim(p_payload->>'lost_reason') else null end,
    case when v_stage = 'lost' then now() else null end, nullif(p_payload->>'template_id', '')::uuid,
    coalesce(nullif(p_payload->>'business_type', ''), 'general'), nullif(trim(p_payload->>'category'), ''), coalesce(p_payload->'custom_fields', '{}'::jsonb)
  ) returning * into v_opportunity;
  return to_jsonb(v_opportunity);
end;
$$;

revoke all on function public.project_code_prefix(text) from public, anon, authenticated;
revoke all on function public.next_job_sequence(text, integer, text) from public, anon, authenticated;
revoke all on function public.assign_project_code() from public, anon, authenticated;
revoke all on function public.save_project_type(text, text, uuid) from public, anon;
revoke all on function public.preview_project_code(text) from public, anon;
grant execute on function public.save_project_type(text, text, uuid) to authenticated;
grant execute on function public.preview_project_code(text) to authenticated;
revoke all on function public.preview_crm_opportunity_number(text) from public, anon;
revoke all on function public.create_crm_opportunity_simple(jsonb) from public, anon;
grant execute on function public.preview_crm_opportunity_number(text) to authenticated;
grant execute on function public.create_crm_opportunity_simple(jsonb) to authenticated;

commit;
