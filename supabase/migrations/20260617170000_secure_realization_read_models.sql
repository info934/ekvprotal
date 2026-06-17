CREATE OR REPLACE FUNCTION public.can_read_module(p_module text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = p_module
        AND (rp.can_read = true OR rp.can_edit = true OR rp.can_admin = true)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_realization_financials()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_user_role() IN ('admin', 'super_manager'), false);
$$;

CREATE OR REPLACE FUNCTION public.can_access_realization(p_realization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_user_role() IN ('admin', 'super_manager'), false)
    OR public.can_edit_module('realizace')
    OR EXISTS (
      SELECT 1
      FROM public.realizations r
      WHERE r.id = p_realization_id
        AND (
          r.lead_person_id = public.get_member_id()
          OR public.get_member_id() = ANY(COALESCE(r.team_members, ARRAY[]::uuid[]))
          OR EXISTS (
            SELECT 1
            FROM public.realization_profit_shares rps
            WHERE rps.realizace_id = r.id
              AND rps.member_id = public.get_member_id()
          )
          OR EXISTS (
            SELECT 1
            FROM public.attendance a
            WHERE a.realizace_id = r.id
              AND a.member_id = public.get_member_id()
          )
          OR EXISTS (
            SELECT 1
            FROM public.project_members pm
            WHERE pm.project_id = r.linked_project_id
              AND pm.member_id = public.get_member_id()
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.list_realizations_safe()
RETURNS TABLE (
  id uuid,
  name text,
  status text,
  type text,
  start_date date,
  planned_end_date date,
  actual_end_date date,
  created_at timestamptz,
  team_members uuid[],
  contract_amount numeric,
  expected_total_cost numeric,
  actual_costs numeric,
  budget numeric,
  investor jsonb,
  lead_person jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_view_finance boolean := public.can_view_realization_financials();
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.status,
    r.type,
    r.start_date,
    r.planned_end_date,
    r.actual_end_date,
    r.created_at,
    r.team_members,
    CASE WHEN v_can_view_finance THEN r.contract_amount ELSE NULL::numeric END AS contract_amount,
    CASE WHEN v_can_view_finance THEN r.expected_total_cost ELSE NULL::numeric END AS expected_total_cost,
    CASE WHEN v_can_view_finance THEN r.actual_costs ELSE NULL::numeric END AS actual_costs,
    CASE WHEN v_can_view_finance THEN r.budget ELSE NULL::numeric END AS budget,
    CASE
      WHEN s.id IS NULL THEN NULL::jsonb
      ELSE jsonb_build_object('id', s.id, 'name', s.name)
    END AS investor,
    CASE
      WHEN m.id IS NULL THEN NULL::jsonb
      ELSE jsonb_build_object('id', m.id, 'name', m.name)
    END AS lead_person
  FROM public.realizations r
  LEFT JOIN public.subjects s ON s.id = r.investor_id
  LEFT JOIN public.members m ON m.id = r.lead_person_id
  WHERE public.can_access_realization(r.id)
  ORDER BY r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_realization_safe(p_realization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_view_finance boolean := public.can_view_realization_financials();
  v_result jsonb;
BEGIN
  IF p_realization_id IS NULL THEN
    RAISE EXCEPTION 'realization_id is required';
  END IF;

  IF NOT public.can_access_realization(p_realization_id) THEN
    RAISE EXCEPTION 'Not allowed to read this realization';
  END IF;

  SELECT jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'location_address', r.location_address,
    'location_gps', r.location_gps,
    'type', r.type,
    'status', r.status,
    'start_date', r.start_date,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'planned_end_date', r.planned_end_date,
    'actual_end_date', r.actual_end_date,
    'investor_id', r.investor_id,
    'lead_person_id', r.lead_person_id,
    'team_members', COALESCE(to_jsonb(r.team_members), '[]'::jsonb),
    'linked_project_id', r.linked_project_id,
    'crm_opportunity_id', r.crm_opportunity_id,
    'contract_amount', CASE WHEN v_can_view_finance THEN r.contract_amount ELSE NULL::numeric END,
    'expected_total_cost', CASE WHEN v_can_view_finance THEN r.expected_total_cost ELSE NULL::numeric END,
    'actual_costs', CASE WHEN v_can_view_finance THEN r.actual_costs ELSE NULL::numeric END,
    'budget', CASE WHEN v_can_view_finance THEN r.budget ELSE NULL::numeric END,
    'profit_margin_percent', CASE WHEN v_can_view_finance THEN r.profit_margin_percent ELSE NULL::numeric END,
    'profit_share_percent', CASE WHEN v_can_view_finance THEN r.profit_share_percent ELSE NULL::numeric END,
    'overhead_percent', CASE WHEN v_can_view_finance THEN r.overhead_percent ELSE NULL::numeric END,
    'investor', CASE
      WHEN s.id IS NULL THEN NULL::jsonb
      ELSE jsonb_build_object('id', s.id, 'name', s.name)
    END,
    'lead_person', CASE
      WHEN m.id IS NULL THEN NULL::jsonb
      ELSE jsonb_build_object('id', m.id, 'name', m.name)
    END
  )
  INTO v_result
  FROM public.realizations r
  LEFT JOIN public.subjects s ON s.id = r.investor_id
  LEFT JOIN public.members m ON m.id = r.lead_person_id
  WHERE r.id = p_realization_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Realization not found';
  END IF;

  RETURN v_result;
END;
$$;

DROP POLICY IF EXISTS "Enable read for authenticated users on realizations" ON public.realizations;
DROP POLICY IF EXISTS "Enable insert for authenticated users on realizations" ON public.realizations;
DROP POLICY IF EXISTS "Enable update for authenticated users on realizations" ON public.realizations;
DROP POLICY IF EXISTS "Enable delete for admins on realizations" ON public.realizations;
DROP POLICY IF EXISTS "Realizations read for assigned users or realization editors" ON public.realizations;
DROP POLICY IF EXISTS "Realizations insert for realization editors" ON public.realizations;
DROP POLICY IF EXISTS "Realizations update for realization editors" ON public.realizations;
DROP POLICY IF EXISTS "Realizations delete for realization admins" ON public.realizations;

CREATE POLICY "Realizations read for assigned users or realization editors"
ON public.realizations
FOR SELECT TO authenticated
USING (public.can_access_realization(id));

CREATE POLICY "Realizations insert for realization editors"
ON public.realizations
FOR INSERT TO authenticated
WITH CHECK (public.can_edit_module('realizace'));

CREATE POLICY "Realizations update for realization editors"
ON public.realizations
FOR UPDATE TO authenticated
USING (public.can_edit_module('realizace'))
WITH CHECK (public.can_edit_module('realizace'));

CREATE POLICY "Realizations delete for realization admins"
ON public.realizations
FOR DELETE TO authenticated
USING (public.can_admin_module('realizace'));

REVOKE ALL ON FUNCTION public.can_read_module(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_module(text) TO authenticated;

REVOKE ALL ON FUNCTION public.can_view_realization_financials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_realization_financials() TO authenticated;

REVOKE ALL ON FUNCTION public.can_access_realization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_realization(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_realizations_safe() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_realizations_safe() TO authenticated;

REVOKE ALL ON FUNCTION public.get_realization_safe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_realization_safe(uuid) TO authenticated;
