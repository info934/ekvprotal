BEGIN;
-- Internal working notes only. Publication/external delivery are deliberately separate.
CREATE TABLE public.meeting_notes (
 id uuid PRIMARY KEY,
 plan_id uuid NOT NULL REFERENCES public.planning_plans(id) ON DELETE RESTRICT,
 title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
 meeting_date date NOT NULL,
 participants text NOT NULL DEFAULT '' CHECK (length(participants)<=5000),
 points jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(points)='array'),
 version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid NOT NULL REFERENCES auth.users(id)
);
CREATE INDEX meeting_notes_plan_date_idx ON public.meeting_notes(plan_id,meeting_date DESC,id);
CREATE TABLE public.meeting_note_versions (
 note_id uuid NOT NULL REFERENCES public.meeting_notes(id) ON DELETE RESTRICT,
 version integer NOT NULL,
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(note_id,version)
);
ALTER TABLE public.meeting_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_note_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meeting_notes,public.meeting_note_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.meeting_notes,public.meeting_note_versions TO authenticated;
GRANT ALL ON public.meeting_notes,public.meeting_note_versions TO service_role;
CREATE POLICY meeting_notes_read ON public.meeting_notes FOR SELECT TO authenticated
 USING (public.get_user_role() IS NOT NULL AND public.planning_can_read_plan(plan_id));
CREATE POLICY meeting_note_versions_read ON public.meeting_note_versions FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.meeting_notes n WHERE n.id=note_id));
CREATE FUNCTION public.save_meeting_note(p_id uuid,p_plan_id uuid,p_version integer,p_title text,p_date date,p_participants text,p_points jsonb)
RETURNS public.meeting_notes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE previous public.meeting_notes; saved public.meeting_notes; point jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.get_user_role() IS NULL OR NOT public.planning_can_edit_plan(p_plan_id) THEN RAISE EXCEPTION 'Nemáte oprávnění upravovat zápisy této zakázky.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_version IS NULL OR p_version<0 OR p_date IS NULL OR NOT isfinite(p_date) OR coalesce(length(btrim(p_title)),0) NOT BETWEEN 1 AND 200 OR coalesce(length(p_participants),0)>5000 OR p_points IS NULL OR jsonb_typeof(p_points)<>'array' THEN RAISE EXCEPTION 'Vyplňte platný název, datum a body zápisu.'; END IF;
 IF jsonb_array_length(p_points)>100 THEN RAISE EXCEPTION 'Zápis může mít nejvýše 100 bodů.'; END IF;
 FOR point IN SELECT value FROM jsonb_array_elements(p_points) LOOP
  IF jsonb_typeof(point)<>'object' OR coalesce(point->>'kind','') NOT IN ('information','decision','task') OR coalesce(length(btrim(point->>'text')),0) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Každý bod musí mít typ a text.'; END IF;
  IF point->>'kind'='task' AND nullif(point->>'planning_item_id','') IS NULL THEN RAISE EXCEPTION 'K bodu Úkol vyberte existující úkol z plánu.'; END IF;
  IF nullif(point->>'planning_item_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.planning_items i WHERE i.id=(point->>'planning_item_id')::uuid AND i.plan_id=p_plan_id AND i.item_type='task') THEN RAISE EXCEPTION 'Navázaný úkol nepatří do této zakázky.'; END IF;
 END LOOP;
 -- Serialize even two first saves with the same client-generated ID.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO previous FROM public.meeting_notes WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF previous.plan_id<>p_plan_id OR previous.version<>p_version THEN RAISE EXCEPTION 'Zápis mezitím upravil někdo jiný. Znovu ho otevřete; vaše rozepsané změny zůstávají ve formuláři.' USING ERRCODE='40001'; END IF;
  UPDATE public.meeting_notes SET title=btrim(p_title),meeting_date=p_date,participants=coalesce(p_participants,''),points=p_points,version=version+1,updated_at=now(),updated_by=auth.uid() WHERE id=p_id RETURNING * INTO saved;
 ELSE
  IF p_version<>0 THEN RAISE EXCEPTION 'Zápis nebyl nalezen.'; END IF;
  INSERT INTO public.meeting_notes(id,plan_id,title,meeting_date,participants,points,updated_by) VALUES(p_id,p_plan_id,btrim(p_title),p_date,coalesce(p_participants,''),p_points,auth.uid()) RETURNING * INTO saved;
 END IF;
 INSERT INTO public.meeting_note_versions(note_id,version,snapshot) VALUES(saved.id,saved.version,to_jsonb(saved));
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.save_meeting_note(uuid,uuid,integer,text,date,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_meeting_note(uuid,uuid,integer,text,date,text,jsonb) TO authenticated;
COMMIT;
