BEGIN;
-- Plans are intentions only. No triggers write attendance, payroll or labor costs.
CREATE TABLE public.attendance_plans (
 id uuid PRIMARY KEY,
 member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
 date date NOT NULL,
 start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
 end_minute integer NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
 break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
 kind text NOT NULL CHECK (kind IN ('work','home_office','absence')),
 note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
 cancelled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (end_minute > start_minute AND break_minutes < end_minute - start_minute)
);
CREATE INDEX attendance_plans_member_date_idx ON public.attendance_plans(member_id,date);
ALTER TABLE public.attendance_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_plans FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.attendance_plans TO authenticated;
GRANT ALL ON public.attendance_plans TO service_role;
CREATE POLICY attendance_plans_read ON public.attendance_plans FOR SELECT TO authenticated USING (
 coalesce(public.can_admin_module('attendance'),false) OR
 (member_id=(select public.get_member_id()) AND coalesce(public.can_read_module('attendance'),false))
);
CREATE FUNCTION public.save_attendance_plan(p_id uuid,p_member_id uuid,p_date date,p_start integer,p_end integer,p_break integer,p_kind text,p_note text,p_version integer DEFAULT 0,p_cancel boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=public.get_member_id(); v_row public.attendance_plans; v_previous public.attendance_plans; v_exists boolean;
BEGIN
 IF v_actor IS NULL OR (NOT coalesce(public.can_admin_module('attendance'),false) AND
   (p_member_id IS DISTINCT FROM v_actor OR NOT coalesce(public.can_edit_module('attendance'),false))) THEN
  RAISE EXCEPTION 'Nemáte oprávnění upravovat tento plán docházky.' USING ERRCODE='42501';
 END IF;
 IF p_id IS NULL OR p_member_id IS NULL OR p_version IS NULL OR p_cancel IS NULL THEN RAISE EXCEPTION 'Chybí identifikátor nebo verze plánu.'; END IF;
 -- Serialize writes for a member, including overlapping concurrent inserts.
 PERFORM 1 FROM public.members WHERE id=p_member_id AND coalesce(attendance_enabled,false) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pracovník nemá povolenou docházku.'; END IF;
 SELECT * INTO v_previous FROM public.attendance_plans WHERE id=p_id;
 v_exists:=FOUND;
 IF v_exists AND v_previous.member_id IS DISTINCT FROM p_member_id THEN RAISE EXCEPTION 'Plán patří jinému pracovníkovi.' USING ERRCODE='42501'; END IF;
 IF p_cancel THEN
  IF NOT v_exists THEN RAISE EXCEPTION 'Plán nebyl nalezen.'; END IF;
  IF v_previous.cancelled THEN RETURN to_jsonb(v_previous); END IF;
  IF v_previous.version <> p_version THEN RAISE EXCEPTION 'Plán mezitím někdo změnil. Obnovte kalendář.'; END IF;
  UPDATE public.attendance_plans SET cancelled=true,version=version+1,updated_at=now() WHERE id=p_id RETURNING * INTO v_row;
 ELSE
  IF p_date IS NULL OR NOT isfinite(p_date) OR p_start IS NULL OR p_end IS NULL OR p_break IS NULL OR p_kind IS NULL
   OR p_start NOT BETWEEN 0 AND 1439 OR p_end NOT BETWEEN 1 AND 1440 OR p_end<=p_start
   OR p_break<0 OR p_break>=p_end-p_start OR p_kind NOT IN ('work','home_office','absence') OR length(coalesce(p_note,''))>1000 THEN
   RAISE EXCEPTION 'Zkontrolujte datum, začátek, konec a délku přestávky. Směnu přes půlnoc rozdělte do dvou dnů.';
  END IF;
  -- Safe retry after an uncertain response; changed payload never silently overwrites.
  IF v_exists AND NOT v_previous.cancelled AND v_previous.date=p_date AND v_previous.start_minute=p_start
   AND v_previous.end_minute=p_end AND v_previous.break_minutes=p_break AND v_previous.kind=p_kind
   AND v_previous.note=btrim(coalesce(p_note,'')) AND (v_previous.version=p_version+1 OR v_previous.version=p_version) THEN RETURN to_jsonb(v_previous); END IF;
  IF (v_exists AND (v_previous.version<>p_version OR v_previous.cancelled)) OR (NOT v_exists AND p_version<>0) THEN
   RAISE EXCEPTION 'Plán mezitím někdo změnil. Obnovte kalendář.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.attendance_plans WHERE member_id=p_member_id AND date=p_date AND NOT cancelled AND id<>p_id AND start_minute<p_end AND end_minute>p_start) THEN
   RAISE EXCEPTION 'V tomto čase už je naplánovaná směna nebo nepřítomnost.';
  END IF;
  IF v_exists THEN
   UPDATE public.attendance_plans SET date=p_date,start_minute=p_start,end_minute=p_end,break_minutes=p_break,kind=p_kind,note=btrim(coalesce(p_note,'')),version=version+1,updated_at=now() WHERE id=p_id RETURNING * INTO v_row;
  ELSE
   INSERT INTO public.attendance_plans(id,member_id,date,start_minute,end_minute,break_minutes,kind,note,created_by)
   VALUES(p_id,p_member_id,p_date,p_start,p_end,p_break,p_kind,btrim(coalesce(p_note,'')),auth.uid()) RETURNING * INTO v_row;
  END IF;
 END IF;
 PERFORM public.log_workflow_audit('attendance_plan_changed',jsonb_build_object('before',to_jsonb(v_previous),'after',to_jsonb(v_row)));
 RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.save_attendance_plan(uuid,uuid,date,integer,integer,integer,text,text,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_attendance_plan(uuid,uuid,date,integer,integer,integer,text,text,integer,boolean) TO authenticated;
COMMIT;
