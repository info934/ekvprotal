begin;

insert into public.app_settings(key, value) values
  ('realization_retention_summary_enabled', 'true'),
  ('realization_retention_summary_recipient', 'info@ekvproject.cz'),
  ('realization_retention_summary_function_url', 'https://yurysbxxevtuvhrbmloc.supabase.co/functions/v1/send-realization-retention-summary')
on conflict (key) do nothing;

create or replace function public.invoke_realization_retention_summary()
returns bigint language plpgsql security definer set search_path = public, vault, net as $$
declare v_url text; v_secret text; v_request_id bigint;
begin
  select value into v_url from public.app_settings where key = 'realization_retention_summary_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'realization_retention_cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise exception 'Realization retention summary scheduler is not configured';
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-realization-retention-secret', v_secret),
    body := jsonb_build_object('action', 'scheduled')
  ) into v_request_id;
  return v_request_id;
end;
$$;
revoke all on function public.invoke_realization_retention_summary() from public, anon, authenticated, service_role;

do $$ declare v_job record; begin
  for v_job in select jobid from cron.job where jobname = 'realization-retention-summary-prague' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
  perform cron.schedule(
    'realization-retention-summary-prague',
    '0 5,6 1 * *',
    'select public.invoke_realization_retention_summary();'
  );
end $$;

commit;
