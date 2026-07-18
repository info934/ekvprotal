-- Auditable AI-assisted extraction of contract values and billing milestones.
-- AI output is always a proposal. Only an admin can apply reviewed values.

create table if not exists public.contract_extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('project', 'realization')),
  project_id uuid references public.projects(id) on delete cascade,
  realization_id uuid references public.realizations(id) on delete cascade,
  source_provider text not null default 'sharepoint',
  source_connection_id uuid references public.document_storage_connections(id) on delete set null,
  source_file_id text,
  source_file_name text not null,
  source_web_url text,
  source_mime_type text,
  source_sha256 text,
  status text not null default 'processing'
    check (status in ('processing', 'review', 'approved', 'rejected', 'failed')),
  model text,
  prompt_version text not null default 'contract-finance-v1',
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  extracted_data jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_message text,
  review_note text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_extraction_jobs_target_check check (
    (entity_type = 'project' and project_id is not null and realization_id is null)
    or (entity_type = 'realization' and realization_id is not null and project_id is null)
  )
);

create index if not exists idx_contract_extraction_jobs_project
  on public.contract_extraction_jobs(project_id, created_at desc) where project_id is not null;
create index if not exists idx_contract_extraction_jobs_realization
  on public.contract_extraction_jobs(realization_id, created_at desc) where realization_id is not null;
create index if not exists idx_contract_extraction_jobs_source_hash
  on public.contract_extraction_jobs(source_sha256, created_at desc) where source_sha256 is not null;

create table if not exists public.contract_extraction_milestones (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.contract_extraction_jobs(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  name text not null,
  condition_text text,
  performance_date date,
  planned_issue_date date,
  due_date date,
  due_days integer check (due_days is null or due_days between 0 and 365),
  amount_excl_vat numeric(14,2) check (amount_excl_vat is null or amount_excl_vat >= 0),
  vat_rate numeric(5,2) check (vat_rate is null or vat_rate in (0, 12, 21)),
  percent_of_contract numeric(7,3) check (percent_of_contract is null or percent_of_contract between 0 and 100),
  confidence numeric(5,4) check (confidence is null or confidence between 0 and 1),
  evidence text,
  accepted boolean not null default true,
  created_at timestamptz not null default now(),
  constraint contract_extraction_milestones_unique unique (extraction_id, sequence_number),
  constraint contract_extraction_milestones_dates_check check (
    due_date is null or planned_issue_date is null or due_date >= planned_issue_date
  )
);

create or replace function public.touch_contract_extraction_job()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_contract_extraction_job on public.contract_extraction_jobs;
create trigger trg_touch_contract_extraction_job
before update on public.contract_extraction_jobs
for each row execute function public.touch_contract_extraction_job();

alter table public.contract_extraction_jobs enable row level security;
alter table public.contract_extraction_milestones enable row level security;

drop policy if exists "Contract extractions visible to admins" on public.contract_extraction_jobs;
create policy "Contract extractions visible to admins" on public.contract_extraction_jobs
for select to authenticated using (coalesce(public.get_user_role() = 'admin', false));
drop policy if exists "Contract extractions managed by admins" on public.contract_extraction_jobs;
create policy "Contract extractions managed by admins" on public.contract_extraction_jobs
for all to authenticated
using (coalesce(public.get_user_role() = 'admin', false))
with check (coalesce(public.get_user_role() = 'admin', false));

drop policy if exists "Contract extraction milestones visible to admins" on public.contract_extraction_milestones;
create policy "Contract extraction milestones visible to admins" on public.contract_extraction_milestones
for select to authenticated using (
  coalesce(public.get_user_role() = 'admin', false)
  and exists (select 1 from public.contract_extraction_jobs j where j.id = extraction_id)
);
drop policy if exists "Contract extraction milestones managed by admins" on public.contract_extraction_milestones;
create policy "Contract extraction milestones managed by admins" on public.contract_extraction_milestones
for all to authenticated
using (coalesce(public.get_user_role() = 'admin', false))
with check (coalesce(public.get_user_role() = 'admin', false));

revoke all on public.contract_extraction_jobs, public.contract_extraction_milestones from public, anon;
grant select, insert, update, delete on public.contract_extraction_jobs, public.contract_extraction_milestones to authenticated;
grant all on public.contract_extraction_jobs, public.contract_extraction_milestones to service_role;

create or replace function public.apply_contract_extraction(
  p_extraction_id uuid,
  p_update_contract_value boolean default true,
  p_create_billing_milestones boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_job public.contract_extraction_jobs%rowtype;
  v_data jsonb;
  v_contract_gross numeric;
  v_contract_net numeric;
  v_contract_vat numeric;
  v_inserted integer := 0;
  v_next_number integer := 1;
  v_row public.contract_extraction_milestones%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'Admin access required'; end if;

  select * into v_job from public.contract_extraction_jobs where id = p_extraction_id for update;
  if not found then raise exception 'Contract extraction not found'; end if;
  if v_job.status <> 'review' then raise exception 'Only a reviewed proposal can be applied'; end if;

  v_data := v_job.extracted_data;
  v_contract_gross := nullif(v_data ->> 'contract_value_incl_vat', '')::numeric;
  v_contract_net := nullif(v_data ->> 'contract_value_excl_vat', '')::numeric;
  v_contract_vat := nullif(v_data ->> 'vat_rate', '')::numeric;
  if v_contract_gross is null and v_contract_net is not null and v_contract_vat is not null then
    v_contract_gross := round(v_contract_net * (1 + v_contract_vat / 100), 2);
  end if;

  if p_update_contract_value and coalesce(v_data ->> 'currency', 'CZK') <> 'CZK' then
    raise exception 'Contract value in a foreign currency requires manual conversion';
  end if;
  if p_update_contract_value and coalesce(v_contract_gross, 0) <= 0 then
    raise exception 'Reviewed contract value is required before updating the project';
  end if;

  if p_update_contract_value and v_contract_gross is not null and v_contract_gross > 0 then
    if v_job.entity_type = 'project' then
      update public.projects set price = v_contract_gross where id = v_job.project_id;
    else
      update public.realizations set contract_amount = v_contract_gross where id = v_job.realization_id;
    end if;
  end if;

  if p_create_billing_milestones then
    select coalesce(max(installment_number), 0) + 1 into v_next_number
    from public.entity_billing_milestones
    where (v_job.entity_type = 'project' and project_id = v_job.project_id)
       or (v_job.entity_type = 'realization' and realization_id = v_job.realization_id);

    for v_row in
      select * from public.contract_extraction_milestones
      where extraction_id = p_extraction_id and accepted = true
        and (amount_excl_vat is not null or percent_of_contract is not null)
      order by sequence_number
    loop
      if v_row.amount_excl_vat is null then
        raise exception 'Accepted billing milestone % is missing an amount', v_row.sequence_number;
      end if;
      if v_row.vat_rate is null then
        raise exception 'Accepted billing milestone % is missing a VAT rate', v_row.sequence_number;
      end if;
      insert into public.entity_billing_milestones (
        entity_type, project_id, realization_id, installment_number, name, status,
        performance_date, planned_issue_date, due_date, amount_excl_vat, vat_rate,
        percent_of_contract, note
      ) values (
        v_job.entity_type, v_job.project_id, v_job.realization_id, v_next_number + v_inserted,
        v_row.name, 'planned', v_row.performance_date, v_row.planned_issue_date,
        coalesce(v_row.due_date, case when v_row.planned_issue_date is not null and v_row.due_days is not null
          then v_row.planned_issue_date + v_row.due_days else null end),
        v_row.amount_excl_vat, v_row.vat_rate,
        v_row.percent_of_contract,
        concat_ws(E'\n', v_row.condition_text, case when v_row.evidence is not null then 'Zdroj ve smlouvě: ' || v_row.evidence end)
      );
      v_inserted := v_inserted + 1;
    end loop;
  end if;

  update public.contract_extraction_jobs
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), applied_at = now()
  where id = p_extraction_id;

  insert into public.audit_logs (user_id, user_email, action, details)
  values (auth.uid(), auth.jwt() ->> 'email', 'contract_extraction_applied', jsonb_build_object(
    'extraction_id', p_extraction_id,
    'entity_type', v_job.entity_type,
    'project_id', v_job.project_id,
    'realization_id', v_job.realization_id,
    'updated_contract_value', p_update_contract_value,
    'created_billing_milestones', v_inserted
  ));

  return jsonb_build_object('success', true, 'milestones_created', v_inserted, 'contract_value', v_contract_gross);
end;
$$;

revoke all on function public.apply_contract_extraction(uuid, boolean, boolean) from public, anon;
grant execute on function public.apply_contract_extraction(uuid, boolean, boolean) to authenticated, service_role;

create or replace function public.review_contract_extraction_milestone(
  p_milestone_id uuid,
  p_accepted boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_extraction_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'Admin access required'; end if;

  update public.contract_extraction_milestones m
  set accepted = p_accepted
  from public.contract_extraction_jobs j
  where m.id = p_milestone_id
    and j.id = m.extraction_id
    and j.status = 'review'
  returning m.extraction_id into v_extraction_id;
  if v_extraction_id is null then raise exception 'Editable contract milestone not found'; end if;

  insert into public.audit_logs (user_id, user_email, action, details)
  values (auth.uid(), auth.jwt() ->> 'email', 'contract_extraction_milestone_reviewed', jsonb_build_object(
    'extraction_id', v_extraction_id, 'milestone_id', p_milestone_id, 'accepted', p_accepted
  ));
end;
$$;

create or replace function public.reject_contract_extraction(
  p_extraction_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_job public.contract_extraction_jobs%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'Admin access required'; end if;
  if v_reason is null or char_length(v_reason) < 3 then raise exception 'Rejection reason is required'; end if;

  select * into v_job from public.contract_extraction_jobs where id = p_extraction_id for update;
  if not found then raise exception 'Contract extraction not found'; end if;
  if v_job.status <> 'review' then raise exception 'Only a reviewed proposal can be rejected'; end if;

  update public.contract_extraction_jobs
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_reason
  where id = p_extraction_id;

  insert into public.audit_logs (user_id, user_email, action, details)
  values (auth.uid(), auth.jwt() ->> 'email', 'contract_extraction_rejected', jsonb_build_object(
    'extraction_id', p_extraction_id, 'entity_type', v_job.entity_type,
    'project_id', v_job.project_id, 'realization_id', v_job.realization_id, 'reason', v_reason
  ));
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.review_contract_extraction_milestone(uuid, boolean) from public, anon;
grant execute on function public.review_contract_extraction_milestone(uuid, boolean) to authenticated, service_role;
revoke all on function public.reject_contract_extraction(uuid, text) from public, anon;
grant execute on function public.reject_contract_extraction(uuid, text) to authenticated, service_role;
