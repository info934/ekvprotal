create or replace function public.allocate_crm_number(p_document_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setting public.crm_numbering_settings%rowtype;
  v_year text;
  v_number text;
  v_default_prefix text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (
    public.can_edit_crm()
    or public.can_edit_module('projects')
    or public.can_edit_module('realizace')
  ) then
    raise exception 'Not allowed to allocate document numbers';
  end if;

  v_default_prefix := case p_document_type
    when 'opportunity' then 'OP'
    when 'offer' then 'NAB'
    when 'order' then 'OBJ'
    when 'contract' then 'SML'
    when 'handover_full' then 'PP'
    when 'handover_partial' then 'CPP'
    when 'service_protocol' then 'SP'
    else null
  end;
  if v_default_prefix is null then raise exception 'Unsupported document type %', p_document_type; end if;

  insert into public.crm_numbering_settings (document_type, prefix, next_number, padding, year_format)
  values (p_document_type, v_default_prefix, 1, 3, 'YY')
  on conflict (document_type) do nothing;

  select * into v_setting
  from public.crm_numbering_settings
  where document_type = p_document_type
  for update;

  v_year := case coalesce(v_setting.year_format, 'YY')
    when 'NONE' then ''
    when 'YYYY' then to_char(current_date, 'YYYY')
    else to_char(current_date, 'YY')
  end;
  v_number := concat_ws('-', nullif(trim(v_setting.prefix), ''), nullif(v_year, ''), lpad(v_setting.next_number::text, greatest(v_setting.padding, 2), '0'));

  update public.crm_numbering_settings
  set next_number = v_setting.next_number + 1,
      updated_at = now()
  where document_type = p_document_type;

  return v_number;
end;
$$;

revoke all on function public.allocate_crm_number(text) from public, anon;
grant execute on function public.allocate_crm_number(text) to authenticated;
