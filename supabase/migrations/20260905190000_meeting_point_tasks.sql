BEGIN;
CREATE OR REPLACE FUNCTION public.create_meeting_point_task(p_note_id uuid,p_version integer,p_point_index integer,p_name text,p_due date,p_member_id uuid)
RETURNS public.meeting_notes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE note public.meeting_notes; item_id uuid; point jsonb; updated_points jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.get_user_role() IS NULL THEN RAISE EXCEPTION 'Přihlaste se.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_note_id::text,0));
 SELECT * INTO note FROM public.meeting_notes WHERE id=p_note_id FOR UPDATE;
 IF NOT FOUND OR NOT public.planning_can_edit_plan(note.plan_id) THEN RAISE EXCEPTION 'Nemáte oprávnění upravovat zápis.' USING ERRCODE='42501'; END IF;
 IF p_version IS NULL OR note.version<>p_version THEN RAISE EXCEPTION 'Zápis se změnil. Obnovte jej před vytvořením úkolu.' USING ERRCODE='40001'; END IF;
 IF p_point_index IS NULL OR p_point_index<0 OR p_point_index>=jsonb_array_length(note.points) THEN RAISE EXCEPTION 'Bod zápisu neexistuje.'; END IF;
 point:=note.points->p_point_index;
 IF nullif(point->>'planning_item_id','') IS NOT NULL THEN RAISE EXCEPTION 'Bod již má navázaný úkol.'; END IF;
 IF coalesce(length(btrim(p_name)),0) NOT BETWEEN 1 AND 200 OR p_due IS NULL OR NOT isfinite(p_due) OR p_due<CURRENT_DATE OR p_member_id IS NULL THEN RAISE EXCEPTION 'Vyplňte název, odpovědnou osobu a dnešní nebo budoucí termín.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.list_planning_members_safe(note.plan_id) m WHERE m.id=p_member_id) THEN RAISE EXCEPTION 'Odpovědná osoba není dostupná pro tento plán.'; END IF;
 item_id:=public.save_planning_item_with_resources(note.plan_id,NULL,jsonb_build_object('name',btrim(p_name),'description',point->>'text','item_type','task','start_at',CURRENT_DATE::text||'T08:00','end_at',p_due::text||'T17:00','status','planned','member_id',p_member_id,'calendar_sync_enabled',false),jsonb_build_array(jsonb_build_object('member_id',p_member_id,'allocation_percent',100)),'[]');
 updated_points:=jsonb_set(note.points,ARRAY[p_point_index::text],point||jsonb_build_object('kind','task','planning_item_id',item_id));
 RETURN public.save_meeting_note(note.id,note.plan_id,note.version,note.title,note.meeting_date,note.participants,updated_points);
END $$;
REVOKE ALL ON FUNCTION public.create_meeting_point_task(uuid,integer,integer,text,date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_meeting_point_task(uuid,integer,integer,text,date,uuid) TO authenticated;
COMMIT;
