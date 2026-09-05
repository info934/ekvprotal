-- Block existing JWTs at the identity helpers and add an AND gate to table RLS.
-- Existing grants and permissive policies are preserved. Accounts without a
-- user_account_status row retain the legacy identity/email fallback behavior.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_member_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_member_id uuid;
  v_email text := lower(nullif(auth.jwt() ->> 'email', ''));
  v_email_matches integer;
BEGIN
  IF v_user_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_account_status s
    WHERE s.auth_user_id = v_user_id AND s.status <> 'active'
  ) THEN
    -- Raising also protects older RPCs with NULL-sensitive role comparisons.
    RAISE EXCEPTION 'Account is disabled.' USING ERRCODE = '42501', DETAIL = 'ACCOUNT_DISABLED';
  END IF;

  SELECT m.id INTO v_member_id FROM public.members m
  WHERE m.auth_user_id = v_user_id LIMIT 1;
  IF v_member_id IS NOT NULL OR v_email IS NULL THEN RETURN v_member_id; END IF;

  SELECT count(*), min(m.id::text)::uuid INTO v_email_matches, v_member_id
  FROM public.members m
  WHERE lower(nullif(m.email, '')) = v_email
    AND (m.auth_user_id IS NULL OR m.auth_user_id = v_user_id);
  IF v_email_matches = 1 THEN RETURN v_member_id; END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  -- Always execute the status guard, even when the account has no member row.
  v_member_id := public.get_member_id();
  SELECT m.user_role INTO v_role FROM public.members m WHERE m.id = v_member_id;
  RETURN coalesce(v_role, 'user');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_permissions(p_role text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text := public.get_user_role();
  v_permissions json;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;
  SELECT json_object_agg(module, json_build_object(
    'can_read', can_read, 'can_edit', can_edit, 'can_admin', can_admin
  )) INTO v_permissions FROM public.role_permissions WHERE role = p_role;
  RETURN v_permissions;
END;
$$;

-- Self-service policies sometimes use auth.uid() directly. A restrictive policy
-- is ANDed with all existing permissive policies and cannot expand access.
-- Apply to current public RLS tables and stored objects; service_role still uses
-- its existing BYPASSRLS privilege. Future RLS tables should include this gate.
DO $$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT n.nspname, c.relname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relrowsecurity AND c.relkind IN ('r', 'p')
      AND (n.nspname = 'public' OR (n.nspname = 'storage' AND c.relname = 'objects'))
      AND NOT (n.nspname = 'public' AND c.relname = 'user_account_status')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS active_account_required ON %I.%I', v_table.nspname, v_table.relname);
    EXECUTE format(
      'CREATE POLICY active_account_required ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.get_user_role()) IS NOT NULL) WITH CHECK ((SELECT public.get_user_role()) IS NOT NULL)',
      v_table.nspname, v_table.relname
    );
  END LOOP;
END;
$$;

-- CREATE OR REPLACE retains the existing function ACLs; do not grant anything.
NOTIFY pgrst, 'reload schema';
COMMIT;
