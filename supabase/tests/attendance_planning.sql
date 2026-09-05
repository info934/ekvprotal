BEGIN;
DO $$
DECLARE a uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); m uuid; n uuid;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(a,a||'@example.invalid'),(u,u||'@example.invalid'),(o,o||'@example.invalid');
 INSERT INTO public.members(auth_user_id,name,email,user_role,attendance_enabled) VALUES(a,'Plan admin',a||'@example.invalid','admin',true),(u,'Plan owner',u||'@example.invalid','user',true),(o,'Plan other',o||'@example.invalid','user',true)
 ON CONFLICT(auth_user_id) DO UPDATE SET user_role=excluded.user_role,attendance_enabled=true;
 SELECT id INTO m FROM public.members WHERE auth_user_id=u; SELECT id INTO n FROM public.members WHERE auth_user_id=o;
 INSERT INTO public.role_permissions(role,module,can_read,can_edit,can_admin) VALUES('user','attendance',true,true,false) ON CONFLICT(role,module) DO UPDATE SET can_read=true,can_edit=true,can_admin=false;
 PERFORM set_config('test.plan_auth',u::text,true); PERFORM set_config('test.plan_admin',a::text,true); PERFORM set_config('test.plan_other_auth',o::text,true); PERFORM set_config('test.plan_member',m::text,true); PERFORM set_config('test.plan_other',n::text,true); PERFORM set_config('test.plan_id',gen_random_uuid()::text,true);
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.plan_auth'),'role','authenticated')::text,true);
DO $$
DECLARE m uuid:=current_setting('test.plan_member')::uuid; id uuid:=current_setting('test.plan_id')::uuid; r jsonb;
BEGIN
 r:=public.save_attendance_plan(id,m,'2026-10-05',480,990,30,'work','Office');
 IF public.save_attendance_plan(id,m,'2026-10-05',480,990,30,'work','Office') IS DISTINCT FROM r THEN RAISE EXCEPTION 'Retry duplicated or changed plan'; END IF;
 IF (SELECT count(*) FROM public.attendance_plans WHERE member_id=m)<>1 THEN RAISE EXCEPTION 'Duplicate plan'; END IF;
 BEGIN
  PERFORM public.save_attendance_plan(gen_random_uuid(),m,'2026-10-05',900,1100,0,'home_office','Overlap');
  RAISE EXCEPTION 'Overlap accepted' USING ERRCODE='23514';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN
  PERFORM public.save_attendance_plan(gen_random_uuid(),m,'infinity'::date,480,990,0,'work','Invalid date');
  RAISE EXCEPTION 'Infinite date accepted' USING ERRCODE='23514';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 PERFORM public.save_attendance_plan(gen_random_uuid(),m,'2026-10-05',990,1100,0,'home_office','Adjacent');
 r:=public.save_attendance_plan(id,m,'2026-10-05',480,990,60,'work','Edited',1);
 IF (r->>'version')::int<>2 THEN RAISE EXCEPTION 'Version not incremented'; END IF;
 BEGIN
  PERFORM public.save_attendance_plan(id,m,'2026-10-05',480,990,90,'work','Stale',1);
  RAISE EXCEPTION 'Stale write accepted' USING ERRCODE='23514';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN
  PERFORM public.save_attendance_plan(gen_random_uuid(),current_setting('test.plan_other')::uuid,'2026-10-05',480,990,0,'work','Foreign');
  RAISE EXCEPTION 'Foreign edit accepted' USING ERRCODE='23514';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.attendance_plans SET break_minutes=0 WHERE member_id=m;
  RAISE EXCEPTION 'Direct update accepted' USING ERRCODE='23514';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.attendance WHERE member_id=m) THEN RAISE EXCEPTION 'Planning wrote actual attendance'; END IF;
 r:=public.save_attendance_plan(id,m,null,null,null,null,null,null,2,true);
 IF NOT (r->>'cancelled')::boolean THEN RAISE EXCEPTION 'Cancellation failed'; END IF;
 IF public.save_attendance_plan(id,m,null,null,null,null,null,null,2,true) IS DISTINCT FROM r THEN RAISE EXCEPTION 'Cancellation retry failed'; END IF;
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.plan_other_auth'),'role','authenticated')::text,true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.attendance_plans WHERE member_id=current_setting('test.plan_member')::uuid) THEN RAISE EXCEPTION 'Foreign plans leaked'; END IF;
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.plan_admin'),'role','authenticated')::text,true);
SELECT public.save_attendance_plan(gen_random_uuid(),current_setting('test.plan_other')::uuid,'2026-10-05',480,990,30,'absence','Admin planned absence');
ROLLBACK;
