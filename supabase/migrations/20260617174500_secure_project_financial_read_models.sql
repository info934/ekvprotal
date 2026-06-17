CREATE OR REPLACE FUNCTION public.can_view_project_financials()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_user_role() IN ('admin', 'super_manager'), false)
    OR public.can_admin_module('projects')
    OR public.can_edit_module('projects')
    OR public.can_read_module('finance');
$$;

CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_user_role() IN ('admin', 'super_manager'), false)
    OR public.can_read_module('projects')
    OR EXISTS (
      SELECT 1
      FROM public.project_members pm
      WHERE pm.project_id = p_project_id
        AND pm.member_id = public.get_member_id()
    );
$$;

CREATE OR REPLACE FUNCTION public.get_user_projects(p_member_id uuid)
RETURNS SETOF public.projects
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid := public.get_member_id();
  v_can_view_finance boolean := public.can_view_project_financials();
  v_can_admin boolean := public.can_admin_module('projects');
BEGIN
  IF p_member_id IS NULL THEN
    p_member_id := v_current_member_id;
  END IF;

  IF p_member_id IS DISTINCT FROM v_current_member_id AND NOT v_can_admin THEN
    RAISE EXCEPTION 'Not allowed to read projects for this member';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.code,
    p.status,
    CASE WHEN v_can_view_finance THEN p.price ELSE NULL::numeric END AS price,
    CASE WHEN v_can_view_finance THEN p.budget_percentage ELSE NULL::numeric END AS budget_percentage,
    p.created_at,
    CASE WHEN v_can_view_finance THEN p.overhead_percentage ELSE NULL::numeric END AS overhead_percentage,
    p.type,
    p.created_by_member_id,
    p.completion_date,
    p.brief,
    p.template_id,
    p.start_date,
    p.shared_drive_link,
    p.stage_id,
    p.location,
    p.client_internal_ref,
    p.is_priority,
    p.location_coordinates,
    p.brief_editable,
    p.investor_id,
    p.client_id,
    p.crm_opportunity_id
  FROM public.projects p
  WHERE EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = p.id
      AND pm.member_id = p_member_id
  )
  ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_projects_safe()
RETURNS TABLE (
  id uuid,
  name text,
  code text,
  status text,
  price numeric,
  budget_percentage numeric,
  overhead_percentage numeric,
  created_at timestamptz,
  type text,
  completion_date date,
  start_date date,
  stage_id uuid,
  investor_id uuid,
  client_id uuid,
  crm_opportunity_id uuid,
  investor jsonb,
  client jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_view_finance boolean := public.can_view_project_financials();
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.code,
    p.status,
    CASE WHEN v_can_view_finance THEN p.price ELSE NULL::numeric END AS price,
    CASE WHEN v_can_view_finance THEN p.budget_percentage ELSE NULL::numeric END AS budget_percentage,
    CASE WHEN v_can_view_finance THEN p.overhead_percentage ELSE NULL::numeric END AS overhead_percentage,
    p.created_at,
    p.type,
    p.completion_date,
    p.start_date,
    p.stage_id,
    p.investor_id,
    p.client_id,
    p.crm_opportunity_id,
    CASE WHEN investor.id IS NULL THEN NULL::jsonb ELSE jsonb_build_object('id', investor.id, 'name', investor.name) END AS investor,
    CASE WHEN client.id IS NULL THEN NULL::jsonb ELSE jsonb_build_object('id', client.id, 'name', client.name) END AS client
  FROM public.projects p
  LEFT JOIN public.subjects investor ON investor.id = p.investor_id
  LEFT JOIN public.subjects client ON client.id = p.client_id
  WHERE public.can_access_project(p.id)
  ORDER BY p.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_project_safe(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_view_finance boolean := public.can_view_project_financials();
  v_result jsonb;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required';
  END IF;

  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'Not allowed to read this project';
  END IF;

  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'code', p.code,
    'status', p.status,
    'price', CASE WHEN v_can_view_finance THEN p.price ELSE NULL::numeric END,
    'budget_percentage', CASE WHEN v_can_view_finance THEN p.budget_percentage ELSE NULL::numeric END,
    'overhead_percentage', CASE WHEN v_can_view_finance THEN p.overhead_percentage ELSE NULL::numeric END,
    'created_at', p.created_at,
    'type', p.type,
    'created_by_member_id', p.created_by_member_id,
    'completion_date', p.completion_date,
    'brief', p.brief,
    'template_id', p.template_id,
    'start_date', p.start_date,
    'shared_drive_link', p.shared_drive_link,
    'stage_id', p.stage_id,
    'location', p.location,
    'client_internal_ref', p.client_internal_ref,
    'is_priority', p.is_priority,
    'location_coordinates', p.location_coordinates,
    'brief_editable', p.brief_editable,
    'investor_id', p.investor_id,
    'client_id', p.client_id,
    'crm_opportunity_id', p.crm_opportunity_id,
    'investor', CASE WHEN investor.id IS NULL THEN NULL::jsonb ELSE jsonb_build_object('id', investor.id, 'name', investor.name) END,
    'client', CASE WHEN client.id IS NULL THEN NULL::jsonb ELSE jsonb_build_object('id', client.id, 'name', client.name) END,
    'stage', CASE WHEN stage.id IS NULL THEN NULL::jsonb ELSE jsonb_build_object('id', stage.id, 'name', stage.name) END,
    'project_manager', CASE WHEN manager.id IS NULL THEN NULL::jsonb ELSE jsonb_build_object('id', manager.id, 'name', manager.name, 'email', manager.email) END
  )
  INTO v_result
  FROM public.projects p
  LEFT JOIN public.subjects investor ON investor.id = p.investor_id
  LEFT JOIN public.subjects client ON client.id = p.client_id
  LEFT JOIN public.project_stages stage ON stage.id = p.stage_id
  LEFT JOIN public.members manager ON manager.id = p.created_by_member_id
  WHERE p.id = p_project_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Project not found';
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_project_members_safe(p_project_id uuid)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  member_id uuid,
  reward_percentage numeric,
  reward_amount numeric,
  reward_type text,
  is_hourly boolean,
  member jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_view_finance boolean := public.can_view_project_financials();
  v_current_member_id uuid := public.get_member_id();
BEGIN
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'Not allowed to read this project team';
  END IF;

  RETURN QUERY
  SELECT
    pm.id,
    pm.project_id,
    pm.member_id,
    CASE WHEN v_can_view_finance OR pm.member_id = v_current_member_id THEN pm.reward_percentage ELSE NULL::numeric END,
    CASE WHEN v_can_view_finance OR pm.member_id = v_current_member_id THEN pm.reward_amount ELSE NULL::numeric END,
    CASE WHEN v_can_view_finance OR pm.member_id = v_current_member_id THEN pm.reward_type ELSE NULL::text END,
    COALESCE(pm.is_hourly, false),
    CASE
      WHEN m.id IS NULL THEN NULL::jsonb
      ELSE jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'email', m.email,
        'phone', m.phone,
        'role', CASE WHEN mr.id IS NULL THEN NULL::jsonb ELSE jsonb_build_object('id', mr.id, 'name', mr.name) END
      )
    END
  FROM public.project_members pm
  LEFT JOIN public.members m ON m.id = pm.member_id
  LEFT JOIN public.member_roles mr ON mr.id = m.role_id
  WHERE pm.project_id = p_project_id
  ORDER BY m.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_project_subcontractors_safe(p_project_id uuid)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  subject_id uuid,
  scope_of_work text,
  price numeric,
  subject jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_can_view_finance boolean := public.can_view_project_financials();
BEGIN
  IF NOT public.can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'Not allowed to read this project subcontractors';
  END IF;

  RETURN QUERY
  SELECT
    ps.id,
    ps.project_id,
    ps.subject_id,
    ps.scope_of_work,
    CASE WHEN v_can_view_finance THEN ps.price ELSE NULL::numeric END AS price,
    CASE
      WHEN s.id IS NULL THEN NULL::jsonb
      ELSE jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'email', s.email,
        'phone', s.phone,
        'contact_person', s.contact_person
      )
    END AS subject
  FROM public.project_subcontractors ps
  LEFT JOIN public.subjects s ON s.id = ps.subject_id
  WHERE ps.project_id = p_project_id
  ORDER BY s.name;
END;
$$;

DROP POLICY IF EXISTS "Project members read access" ON public.project_members;
CREATE POLICY "Project members read own or project finance"
ON public.project_members
FOR SELECT TO authenticated
USING (
  public.can_view_project_financials()
  OR member_id = public.get_member_id()
);

DROP POLICY IF EXISTS "Allow read for project members" ON public.project_subcontractors;
DROP POLICY IF EXISTS "Enable read for project members or admins" ON public.project_subcontractors;
CREATE POLICY "Project subcontractors read for project finance"
ON public.project_subcontractors
FOR SELECT TO authenticated
USING (public.can_view_project_financials());

DROP POLICY IF EXISTS "Enable read for project members or admins" ON public.project_costs;
CREATE POLICY "Project costs read for project finance"
ON public.project_costs
FOR SELECT TO authenticated
USING (public.can_view_project_financials());

DROP POLICY IF EXISTS "Enable read for project members or admins" ON public.project_overhead_costs;
CREATE POLICY "Project overhead costs read for project finance"
ON public.project_overhead_costs
FOR SELECT TO authenticated
USING (public.can_view_project_financials());

REVOKE ALL ON FUNCTION public.can_view_project_financials() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_project(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_projects(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_projects_safe() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_project_safe(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_project_members_safe(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_project_subcontractors_safe(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_view_project_financials() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_projects(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_projects_safe() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_safe(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_project_members_safe(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_project_subcontractors_safe(uuid) TO authenticated;
