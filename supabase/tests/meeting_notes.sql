BEGIN;
DO $$
DECLARE a uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); plan uuid;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(a,a||'@example.invalid'),(u,u||'@example.invalid');
 INSERT INTO public.members(auth_user_id,name,email,user_role) VALUES(a,'KD admin',a||'@example.invalid','admin'),(u,'KD foreign',u||'@example.invalid','user') ON CONFLICT(auth_user_id) DO UPDATE SET user_role=excluded.user_role;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 INSERT INTO public.projects(id,name,code,status,price,budget_percentage,overhead_percentage) VALUES(p,'KD fixture',p::text,'V řešení',10000,100,0);
 INSERT INTO public.role_permissions(role,module,can_read,can_edit,can_admin) VALUES('user','projects',false,false,false) ON CONFLICT(role,module) DO UPDATE SET can_read=false,can_edit=false,can_admin=false;
 plan:=public.ensure_planning_plan('project',p);
 PERFORM set_config('test.kd_admin',a::text,true);PERFORM set_config('test.kd_foreign',u::text,true);PERFORM set_config('test.kd_plan',plan::text,true);PERFORM set_config('test.kd_id',gen_random_uuid()::text,true);
 INSERT INTO public.project_tasks(project_id,name,start_date,end_date,status) VALUES(p,'Blocked roundtrip','2026-09-05','2026-09-06','Blokováno');
 IF NOT EXISTS(SELECT 1 FROM public.planning_items WHERE plan_id=plan AND name='Blocked roundtrip' AND status='blocked') THEN RAISE EXCEPTION 'Forward blocked sync failed'; END IF;
 UPDATE public.planning_items SET status='in_progress' WHERE plan_id=plan AND name='Blocked roundtrip';
 UPDATE public.planning_items SET status='blocked' WHERE plan_id=plan AND name='Blocked roundtrip';
 IF NOT EXISTS(SELECT 1 FROM public.project_tasks WHERE project_id=p AND name='Blocked roundtrip' AND status='Blokováno') THEN RAISE EXCEPTION 'Reverse blocked sync failed'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE plan uuid:=current_setting('test.kd_plan')::uuid; id uuid:=current_setting('test.kd_id')::uuid; r public.meeting_notes;
BEGIN
 r:=public.save_meeting_note(id,plan,0,'KD 01','2026-09-05','Projektant','[{"kind":"decision","text":"Ověřit trasu"}]');
 IF r.version<>1 THEN RAISE EXCEPTION 'Wrong first version';END IF;
 r:=public.save_meeting_note(id,plan,1,'KD 01 oprava','2026-09-05','Projektant','[]');
 IF r.version<>2 OR (SELECT count(*) FROM public.meeting_note_versions WHERE note_id=id)<>2 THEN RAISE EXCEPTION 'Missing history';END IF;
 BEGIN
  PERFORM public.save_meeting_note(id,plan,1,'stale','2026-09-05','','[]');
  RAISE EXCEPTION 'Stale accepted' USING ERRCODE='23514';
 EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN
  PERFORM public.save_meeting_note(id,plan,2,'invalid','2026-09-05','','[{"kind":"task","text":"Unlinked task"}]');
  RAISE EXCEPTION 'Missing task link accepted' USING ERRCODE='23514';
 EXCEPTION WHEN raise_exception THEN NULL;END;
 BEGIN
  UPDATE public.meeting_notes SET title='bypass' WHERE meeting_notes.id=current_setting('test.kd_id')::uuid;
  RAISE EXCEPTION 'Direct update accepted' USING ERRCODE='23514';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.kd_foreign'),'role','authenticated')::text,true);
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.meeting_notes WHERE id=current_setting('test.kd_id')::uuid) THEN RAISE EXCEPTION 'Foreign read'; END IF;
 IF EXISTS(SELECT 1 FROM public.meeting_note_versions WHERE note_id=current_setting('test.kd_id')::uuid) THEN RAISE EXCEPTION 'Foreign history read'; END IF;
 BEGIN
  PERFORM public.save_meeting_note(current_setting('test.kd_id')::uuid,current_setting('test.kd_plan')::uuid,2,'foreign','2026-09-05','','[]');
  RAISE EXCEPTION 'Foreign write' USING ERRCODE='23514';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
ROLLBACK;
