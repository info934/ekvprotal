begin;

-- Zádržné is a receivable/cash-flow schedule. It deliberately remains separate
-- from costs, rewards and the realization margin calculation.
alter table public.realizations
  add column if not exists retention_enabled boolean not null default false;

create table if not exists public.realization_retentions (
  id uuid primary key default gen_random_uuid(),
  realization_id uuid not null references public.realizations(id) on delete cascade,
  label text not null,
  percentage numeric(7,4) not null check (percentage > 0 and percentage <= 100),
  release_condition text not null default 'handover'
    check (release_condition in ('handover', 'warranty', 'custom')),
  notification_at timestamptz,
  recipient_email text,
  auto_request_enabled boolean not null default false,
  status text not null default 'planned'
    check (status in ('planned', 'requested', 'paid', 'cancelled')),
  requested_at timestamptz,
  paid_at timestamptz,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not auto_request_enabled or (notification_at is not null and recipient_email is not null))
);

create index if not exists realization_retentions_due_idx
  on public.realization_retentions(notification_at)
  where auto_request_enabled and status = 'planned';
create index if not exists realization_retentions_realization_idx
  on public.realization_retentions(realization_id, created_at desc);

create or replace function public.touch_realization_retention_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists realization_retentions_updated_at on public.realization_retentions;
create trigger realization_retentions_updated_at
  before update on public.realization_retentions
  for each row execute function public.touch_realization_retention_updated_at();

alter table public.realization_retentions enable row level security;
revoke all on public.realization_retentions from anon, authenticated;
grant all on public.realization_retentions to service_role;

create or replace function public.assert_realization_retention_access(p_realization_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_view_realization_financials() or not public.can_access_realization(p_realization_id) then
    raise exception 'Financial access denied for realization retention';
  end if;
end;
$$;
revoke all on function public.assert_realization_retention_access(uuid) from public, anon;
grant execute on function public.assert_realization_retention_access(uuid) to authenticated, service_role;

create or replace function public.get_realization_retention_settings(p_realization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_enabled boolean;
begin
  perform public.assert_realization_retention_access(p_realization_id);
  select retention_enabled into v_enabled from public.realizations where id = p_realization_id;
  if not found then raise exception 'Realization not found'; end if;
  return jsonb_build_object('enabled', coalesce(v_enabled, false), 'default_recipient', 'info@ekvproject.cz');
end;
$$;
revoke all on function public.get_realization_retention_settings(uuid) from public, anon;
grant execute on function public.get_realization_retention_settings(uuid) to authenticated, service_role;

create or replace function public.set_realization_retention_enabled(p_realization_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_realization_retention_access(p_realization_id);
  update public.realizations set retention_enabled = coalesce(p_enabled, false) where id = p_realization_id;
  if not found then raise exception 'Realization not found'; end if;
  return coalesce(p_enabled, false);
end;
$$;
revoke all on function public.set_realization_retention_enabled(uuid, boolean) from public, anon;
grant execute on function public.set_realization_retention_enabled(uuid, boolean) to authenticated, service_role;

create or replace function public.list_realization_retentions(p_realization_id uuid)
returns setof public.realization_retentions language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_realization_retention_access(p_realization_id);
  return query
    select * from public.realization_retentions
    where realization_id = p_realization_id
    order by notification_at nulls last, created_at asc;
end;
$$;
revoke all on function public.list_realization_retentions(uuid) from public, anon;
grant execute on function public.list_realization_retentions(uuid) to authenticated, service_role;

create or replace function public.save_realization_retention(
  p_retention_id uuid,
  p_realization_id uuid,
  p_payload jsonb
)
returns public.realization_retentions language plpgsql security definer set search_path = public as $$
declare
  v_item public.realization_retentions;
  v_label text := btrim(coalesce(p_payload->>'label', ''));
  v_percentage numeric := nullif(p_payload->>'percentage', '')::numeric;
  v_condition text := coalesce(nullif(p_payload->>'release_condition', ''), 'handover');
  v_notification_at timestamptz := nullif(p_payload->>'notification_at', '')::timestamptz;
  v_recipient text := lower(btrim(coalesce(p_payload->>'recipient_email', '')));
  v_auto boolean := coalesce((p_payload->>'auto_request_enabled')::boolean, false);
  v_note text := nullif(btrim(coalesce(p_payload->>'note', '')), '');
  v_total numeric;
begin
  perform public.assert_realization_retention_access(p_realization_id);
  if v_label = '' or char_length(v_label) > 160 then raise exception 'Retention label is required and must be at most 160 characters'; end if;
  if v_percentage is null or v_percentage <= 0 or v_percentage > 100 then raise exception 'Retention percentage must be greater than 0 and at most 100'; end if;
  if v_condition not in ('handover', 'warranty', 'custom') then raise exception 'Invalid retention release condition'; end if;
  if v_note is not null and char_length(v_note) > 2000 then raise exception 'Retention note must be at most 2000 characters'; end if;
  if v_recipient = '' then v_recipient := null; end if;
  if v_recipient is not null and v_recipient !~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then raise exception 'Invalid recipient email'; end if;
  if v_auto and (v_notification_at is null or v_recipient is null) then
    raise exception 'Automatic retention request requires a notification time and recipient email';
  end if;

  select coalesce(sum(percentage), 0) into v_total
  from public.realization_retentions
  where realization_id = p_realization_id and status <> 'cancelled' and (p_retention_id is null or id <> p_retention_id);
  if v_total + v_percentage > 100 then raise exception 'The total active retention cannot exceed 100 percent'; end if;

  if p_retention_id is null then
    insert into public.realization_retentions(
      realization_id, label, percentage, release_condition, notification_at, recipient_email,
      auto_request_enabled, note, created_by
    ) values (
      p_realization_id, v_label, v_percentage, v_condition, v_notification_at, v_recipient,
      v_auto, v_note, auth.uid()
    ) returning * into v_item;
  else
    select * into v_item from public.realization_retentions where id = p_retention_id for update;
    if not found or v_item.realization_id <> p_realization_id then raise exception 'Retention item not found'; end if;
    if v_item.status in ('paid', 'cancelled') then raise exception 'A paid or cancelled retention cannot be edited'; end if;
    update public.realization_retentions set
      label = v_label, percentage = v_percentage, release_condition = v_condition,
      notification_at = v_notification_at, recipient_email = v_recipient,
      auto_request_enabled = v_auto, note = v_note
    where id = p_retention_id returning * into v_item;
  end if;
  return v_item;
end;
$$;
revoke all on function public.save_realization_retention(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_realization_retention(uuid, uuid, jsonb) to authenticated, service_role;

create or replace function public.set_realization_retention_status(p_retention_id uuid, p_status text)
returns public.realization_retentions language plpgsql security definer set search_path = public as $$
declare v_item public.realization_retentions;
begin
  select * into v_item from public.realization_retentions where id = p_retention_id for update;
  if not found then raise exception 'Retention item not found'; end if;
  perform public.assert_realization_retention_access(v_item.realization_id);
  if p_status not in ('planned', 'paid', 'cancelled') then raise exception 'Invalid retention status'; end if;
  if v_item.status = 'paid' and p_status <> 'paid' then raise exception 'A paid retention cannot be reopened'; end if;
  update public.realization_retentions set
    status = p_status,
    paid_at = case when p_status = 'paid' then coalesce(paid_at, now()) else null end
  where id = p_retention_id returning * into v_item;
  return v_item;
end;
$$;
revoke all on function public.set_realization_retention_status(uuid, text) from public, anon;
grant execute on function public.set_realization_retention_status(uuid, text) to authenticated, service_role;

create or replace function public.delete_realization_retention(p_retention_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_realization_id uuid; v_status text;
begin
  select realization_id, status into v_realization_id, v_status from public.realization_retentions where id = p_retention_id for update;
  if not found then raise exception 'Retention item not found'; end if;
  perform public.assert_realization_retention_access(v_realization_id);
  if v_status <> 'planned' then raise exception 'Only a planned retention can be deleted'; end if;
  delete from public.realization_retentions where id = p_retention_id;
end;
$$;
revoke all on function public.delete_realization_retention(uuid) from public, anon;
grant execute on function public.delete_realization_retention(uuid) to authenticated, service_role;

insert into public.app_settings(key, value) values
  ('realization_retention_function_url', 'https://yurysbxxevtuvhrbmloc.supabase.co/functions/v1/send-realization-retention-request')
on conflict (key) do nothing;

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name = 'realization_retention_cron_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'realization_retention_cron_secret', 'Authenticates scheduled realization retention requests.');
  end if;
end $$;

create or replace function public.verify_realization_retention_cron_secret(p_secret text)
returns boolean language sql security definer set search_path = public, vault as $$
  select p_secret is not null and exists(
    select 1 from vault.decrypted_secrets where name = 'realization_retention_cron_secret' and decrypted_secret = p_secret
  );
$$;
revoke all on function public.verify_realization_retention_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_realization_retention_cron_secret(text) to service_role;

create or replace function public.invoke_realization_retention_requests()
returns bigint language plpgsql security definer set search_path = public, vault, net as $$
declare v_url text; v_secret text; v_request_id bigint;
begin
  select value into v_url from public.app_settings where key = 'realization_retention_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'realization_retention_cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise exception 'Realization retention scheduler is not configured';
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-realization-retention-secret', v_secret),
    body := jsonb_build_object('action', 'scheduled')
  ) into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function public.invoke_realization_retention_requests() from public, anon, authenticated, service_role;

do $$ declare v_job record; begin
  for v_job in select jobid from cron.job where jobname = 'realization-retention-requests-every-15-minutes' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule(
    'realization-retention-requests-every-15-minutes',
    '*/15 * * * *',
    'select public.invoke_realization_retention_requests();'
  );
end $$;

commit;
