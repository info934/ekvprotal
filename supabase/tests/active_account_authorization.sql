-- Integration scenarios for an ISOLATED migrated Supabase test database only.
-- Run as postgres: psql <local-test-db-url> -v ON_ERROR_STOP=1 -f this-file.sql
-- Fixtures and changes are rolled back. No external API calls are made.
BEGIN;

DO $$
DECLARE
  v_active uuid := gen_random_uuid();
  v_disabled uuid := gen_random_uuid();
  v_legacy uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('test.active_id', v_active::text, true);
  PERFORM set_config('test.disabled_id', v_disabled::text, true);
  PERFORM set_config('test.legacy_id', v_legacy::text, true);
  INSERT INTO auth.users (id, email) VALUES
    (v_active, v_active::text || '@example.invalid'),
    (v_disabled, v_disabled::text || '@example.invalid'),
    (v_legacy, v_legacy::text || '@example.invalid');
  -- Auth can provision member rows automatically on the production schema.
  INSERT INTO public.members (name, email, auth_user_id, user_role) VALUES
    ('Active integration fixture', v_active::text || '@example.invalid', v_active, 'admin'),
    ('Disabled integration fixture', v_disabled::text || '@example.invalid', v_disabled, 'admin')
  ON CONFLICT (auth_user_id) DO UPDATE SET name = EXCLUDED.name, user_role = EXCLUDED.user_role;
  INSERT INTO public.members (name, email, auth_user_id, user_role)
  SELECT 'Legacy integration fixture', v_legacy::text || '@example.invalid', v_legacy, 'user'
  WHERE NOT EXISTS (SELECT 1 FROM public.members WHERE auth_user_id = v_legacy);
  UPDATE public.members SET auth_user_id = NULL WHERE auth_user_id = v_legacy;
  INSERT INTO public.user_account_status (auth_user_id, status) VALUES
    (v_active, 'active'), (v_disabled, 'disabled');
  INSERT INTO public.notifications (user_id, type, title, message) VALUES
    (v_active, 'test', 'Security test', 'Test fixture'),
    (v_disabled, 'test', 'Security test', 'Test fixture');
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.active_id'), 'role', 'authenticated'
)::text, true);
DO $$
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Active admin role lost'; END IF;
  IF public.get_member_id() IS NULL THEN RAISE EXCEPTION 'Active identity lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = auth.uid()) THEN RAISE EXCEPTION 'Active self-service RLS blocked'; END IF;
END;
$$;

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.legacy_id'), 'role', 'authenticated',
  'email', current_setting('test.legacy_id') || '@example.invalid'
)::text, true);
DO $$
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'user' THEN RAISE EXCEPTION 'Legacy role lost'; END IF;
  IF public.get_member_id() IS NULL THEN RAISE EXCEPTION 'Unique legacy email fallback lost'; END IF;
END;
$$;

SELECT set_config('request.jwt.claims', json_build_object(
  'sub', current_setting('test.disabled_id'), 'role', 'authenticated'
)::text, true);
DO $$
BEGIN
  BEGIN
    PERFORM public.get_user_role();
    RAISE EXCEPTION 'Disabled admin role was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_member_id();
    RAISE EXCEPTION 'Disabled member identity was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_permissions('admin');
    RAISE EXCEPTION 'Disabled account accessed permission RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id = auth.uid()) THEN
      RAISE EXCEPTION 'Disabled account read self-service data using an old JWT';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (auth.uid(), 'test', 'Blocked write', 'This must fail');
    RAISE EXCEPTION 'Disabled account wrote self-service data using an old JWT';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;

RESET ROLE;
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_user_role()', 'execute') THEN
    RAISE EXCEPTION 'Anonymous identity access was accidentally granted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'notifications' AND policyname = 'active_account_required' AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'Self-service RLS restriction missing';
  END IF;
END;
$$;

-- Reactivation must restore the same identity without replacing the existing JWT.
UPDATE public.user_account_status SET status = 'active'
WHERE auth_user_id = current_setting('test.disabled_id')::uuid;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Reactivation did not restore role'; END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
