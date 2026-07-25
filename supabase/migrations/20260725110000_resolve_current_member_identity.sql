-- Resolve the signed-in employee consistently for payout and other self-service flows.
-- A unique email fallback supports older accounts that were not linked by auth_user_id.
CREATE OR REPLACE FUNCTION public.get_member_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id uuid;
  v_email text := lower(nullif(auth.jwt() ->> 'email', ''));
  v_email_matches integer;
BEGIN
  SELECT m.id
    INTO v_member_id
  FROM public.members m
  WHERE m.auth_user_id = auth.uid()
  LIMIT 1;

  IF v_member_id IS NOT NULL OR v_email IS NULL THEN
    RETURN v_member_id;
  END IF;

  SELECT count(*), min(m.id::text)::uuid
    INTO v_email_matches, v_member_id
  FROM public.members m
  WHERE lower(nullif(m.email, '')) = v_email
    AND (m.auth_user_id IS NULL OR m.auth_user_id = auth.uid());

  IF v_email_matches = 1 THEN
    RETURN v_member_id;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT m.user_role
      FROM public.members m
      WHERE m.id = public.get_member_id()
      LIMIT 1
    ),
    'user'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_current_member_identity()
RETURNS TABLE (
  id uuid,
  name text,
  email text,
  notification_preferences jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.name,
    m.email,
    COALESCE(m.notification_preferences, '{}'::jsonb)
  FROM public.members m
  WHERE m.id = public.get_member_id()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_member_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_member_id() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_current_member_identity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_member_identity() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_current_member_identity() IS
  'Returns only the member identity resolved for the current authenticated user.';
