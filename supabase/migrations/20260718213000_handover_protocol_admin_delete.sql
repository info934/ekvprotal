-- Admin-only deletion for unsigned handover documents with an immutable audit trail.

create or replace function public.delete_handover_protocol(
  p_protocol_id uuid,
  p_reason text default 'Odstraněno administrátorem'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_protocol public.handover_protocols%rowtype;
  v_active_signature_requests integer := 0;
begin
  if auth.uid() is null or coalesce(public.get_user_role(), '') <> 'admin' then
    raise exception 'Dokument může odstranit pouze administrátor.';
  end if;

  select *
  into v_protocol
  from public.handover_protocols
  where id = p_protocol_id
  for update;

  if not found then
    raise exception 'Dokument nebyl nalezen nebo již byl odstraněn.';
  end if;

  if v_protocol.status in ('signed', 'archived') or v_protocol.locked_at is not null then
    raise exception 'Podepsaný, archivovaný nebo uzamčený dokument nelze odstranit.';
  end if;

  if exists (
    select 1
    from public.document_signatures
    where protocol_id = p_protocol_id
  ) then
    raise exception 'Dokument s uloženým podpisem nelze odstranit.';
  end if;

  if to_regclass('public.document_signature_requests') is not null then
    select count(*)
    into v_active_signature_requests
    from public.document_signature_requests
    where protocol_id = p_protocol_id
      and status in ('sent', 'signed');
  end if;

  if v_active_signature_requests > 0 then
    raise exception 'Dokument s odeslanou nebo dokončenou žádostí o podpis nelze odstranit.';
  end if;

  insert into public.audit_logs (user_id, user_email, action, details)
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', ''),
    'handover_protocol_deleted',
    jsonb_build_object(
      'protocol_id', v_protocol.id,
      'number', v_protocol.number,
      'title', v_protocol.title,
      'document_type', v_protocol.document_type,
      'status', v_protocol.status,
      'project_id', v_protocol.project_id,
      'realizace_id', v_protocol.realizace_id,
      'opportunity_id', v_protocol.opportunity_id,
      'reason', coalesce(nullif(trim(p_reason), ''), 'Odstraněno administrátorem')
    )
  );

  delete from public.handover_protocols where id = p_protocol_id;

  return jsonb_build_object(
    'success', true,
    'protocol_id', p_protocol_id,
    'number', v_protocol.number
  );
end;
$$;

revoke all on function public.delete_handover_protocol(uuid, text) from public;
grant execute on function public.delete_handover_protocol(uuid, text) to authenticated;
