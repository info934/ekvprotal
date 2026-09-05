-- Isolated migrated staging database only. All fixtures roll back.
BEGIN;
DO $$
DECLARE a uuid := gen_random_uuid(); u uuid := gen_random_uuid(); m uuid; p uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r jsonb;
BEGIN
 INSERT INTO auth.users(id,email) VALUES (a,a||'@example.invalid'),(u,u||'@example.invalid');
 INSERT INTO public.members(auth_user_id,name,email,user_role) VALUES (a,'Bonus admin',a||'@example.invalid','admin'),(u,'Bonus recipient',u||'@example.invalid','user')
 ON CONFLICT(auth_user_id) DO UPDATE SET user_role=excluded.user_role;
 SELECT id INTO m FROM public.members WHERE auth_user_id=u;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 INSERT INTO public.projects(id,name,code,status,price,budget_percentage,overhead_percentage)
 VALUES(p,'Bonus fixture',p::text,'V řešení',10000,100,0);
 PERFORM public.save_project_member_safe(p,null,jsonb_build_object('member_id',m,'reward_type','percentage','reward_percentage',50));
 PERFORM set_config('test.bonus_admin',a::text,true); PERFORM set_config('test.bonus_user',u::text,true);
 PERFORM set_config('test.bonus_project',p::text,true); PERFORM set_config('test.bonus_member',m::text,true); PERFORM set_config('test.bonus_id',b::text,true);
END;
$$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE p uuid:=current_setting('test.bonus_project')::uuid; m uuid:=current_setting('test.bonus_member')::uuid; b uuid:=current_setting('test.bonus_id')::uuid; r jsonb;
BEGIN
 r:=public.award_project_bonus(b,p,m,2000,'Za dokončení etapy');
 IF public.award_project_bonus(b,p,m,2000,'Za dokončení etapy') IS DISTINCT FROM r THEN RAISE EXCEPTION 'Retry changed result'; END IF;
 IF (SELECT count(*) FROM public.project_bonuses WHERE project_id=p) <> 1 THEN RAISE EXCEPTION 'Duplicate bonus'; END IF;
 BEGIN
  PERFORM public.award_project_bonus(b,p,m,2001,'Za dokončení etapy');
  RAISE EXCEPTION 'Changed retry accepted' USING ERRCODE='23514';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN
  PERFORM public.award_project_bonus(gen_random_uuid(),p,m,3000.01,'Too large');
  RAISE EXCEPTION 'Overbudget accepted' USING ERRCODE='23514';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN
  PERFORM public.award_project_bonus(gen_random_uuid(),p,m,'NaN'::numeric,'Invalid amount');
  RAISE EXCEPTION 'NaN accepted' USING ERRCODE='23514';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN
  PERFORM public.award_project_bonus(gen_random_uuid(),p,m,-1,'Invalid amount');
  RAISE EXCEPTION 'Negative accepted' USING ERRCODE='23514';
 EXCEPTION WHEN raise_exception THEN NULL; END;
END;
$$;
RESET ROLE;
DO $$
DECLARE p uuid:=current_setting('test.bonus_project')::uuid; m uuid:=current_setting('test.bonus_member')::uuid;
BEGIN
 IF (SELECT net_reward FROM public.project_member_reward_state(p) WHERE member_id=m) <> 7000 THEN RAISE EXCEPTION 'Bonus not in canonical reward'; END IF;
 IF (public.project_financial_summary_admin_internal(p)->>'unallocated_reward_budget')::numeric <> 3000 THEN RAISE EXCEPTION 'Wrong remaining budget'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE user_id=current_setting('test.bonus_user')::uuid AND type='project_bonus') <> 1 THEN RAISE EXCEPTION 'Notification not exactly once'; END IF;
 BEGIN
  UPDATE public.projects SET price=3000 WHERE id=p;
  RAISE EXCEPTION 'Reduced budget bypassed bonus allocation' USING ERRCODE='23514';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 PERFORM public.delete_project_member_safe(p,(SELECT id FROM public.project_members WHERE project_id=p AND member_id=m));
 IF (SELECT net_reward FROM public.project_member_reward_state(p) WHERE member_id=m) <> 7000 THEN RAISE EXCEPTION 'Ended assignment lost bonus or entitlement'; END IF;
 UPDATE public.project_members SET reward_type=null,reward_percentage=null,is_hourly=true WHERE project_id=p AND member_id=m;
 IF (SELECT net_reward FROM public.project_member_reward_state(p) WHERE member_id=m) <> 2000 THEN RAISE EXCEPTION 'Hourly member bonus missing'; END IF;
END;
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.bonus_user'),'role','authenticated')::text,true);
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.get_payout_availability(current_setting('test.bonus_member')::uuid,null)->'projects') r WHERE r->>'project_id'=current_setting('test.bonus_project') AND (r->>'available_balance')::numeric=2000) THEN RAISE EXCEPTION 'Hourly bonus is not available in payout workflow'; END IF;
 IF (SELECT count(*) FROM public.project_bonuses WHERE member_id=current_setting('test.bonus_member')::uuid) <> 1 THEN RAISE EXCEPTION 'Own history invisible'; END IF;
 BEGIN
  PERFORM public.award_project_bonus(gen_random_uuid(),current_setting('test.bonus_project')::uuid,current_setting('test.bonus_member')::uuid,1,'Not admin');
  RAISE EXCEPTION 'Worker awarded bonus' USING ERRCODE='23514';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.project_bonuses SET amount=1 WHERE id=current_setting('test.bonus_id')::uuid;
  RAISE EXCEPTION 'Direct mutation allowed' USING ERRCODE='23514';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
ROLLBACK;

