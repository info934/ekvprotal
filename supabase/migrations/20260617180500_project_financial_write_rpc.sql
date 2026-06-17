CREATE OR REPLACE FUNCTION public.can_manage_project_financials()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_user_role() IN ('admin', 'super_manager'), false)
    OR public.can_admin_module('projects')
    OR public.can_edit_module('projects');
$$;

CREATE OR REPLACE FUNCTION public.save_project_safe(
  p_project_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_next_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid := p_project_id;
  v_project public.projects;
  v_current_member_id uuid := public.get_member_id();
BEGIN
  IF NOT public.can_manage_project_financials() THEN
    RAISE EXCEPTION 'Not allowed to save project';
  END IF;

  IF p_payload IS NULL THEN
    p_payload := '{}'::jsonb;
  END IF;

  IF v_project_id IS NULL THEN
    INSERT INTO public.projects (
      name,
      code,
      status,
      price,
      budget_percentage,
      overhead_percentage,
      type,
      created_by_member_id,
      completion_date,
      brief,
      template_id,
      start_date,
      shared_drive_link,
      stage_id,
      location,
      client_internal_ref,
      is_priority,
      location_coordinates,
      brief_editable,
      investor_id,
      client_id,
      crm_opportunity_id
    )
    VALUES (
      NULLIF(p_payload->>'name', ''),
      NULLIF(p_payload->>'code', ''),
      COALESCE(NULLIF(p_payload->>'status', ''), 'nabidka'),
      NULLIF(p_payload->>'price', '')::numeric,
      NULLIF(p_payload->>'budget_percentage', '')::numeric,
      COALESCE(NULLIF(p_payload->>'overhead_percentage', '')::numeric, 0),
      COALESCE(NULLIF(p_payload->>'type', ''), 'Ostatní'),
      COALESCE(NULLIF(p_payload->>'created_by_member_id', '')::uuid, v_current_member_id),
      NULLIF(p_payload->>'completion_date', '')::date,
      NULLIF(p_payload->>'brief', ''),
      NULLIF(p_payload->>'template_id', '')::uuid,
      NULLIF(p_payload->>'start_date', '')::date,
      NULLIF(p_payload->>'shared_drive_link', ''),
      NULLIF(p_payload->>'stage_id', '')::uuid,
      NULLIF(p_payload->>'location', ''),
      NULLIF(p_payload->>'client_internal_ref', ''),
      COALESCE((p_payload->>'is_priority')::boolean, false),
      NULLIF(p_payload->>'location_coordinates', ''),
      NULLIF(p_payload->>'brief_editable', ''),
      NULLIF(p_payload->>'investor_id', '')::uuid,
      NULLIF(p_payload->>'client_id', '')::uuid,
      NULLIF(p_payload->>'crm_opportunity_id', '')::uuid
    )
    RETURNING * INTO v_project;
  ELSE
    UPDATE public.projects p
    SET
      name = CASE WHEN p_payload ? 'name' THEN NULLIF(p_payload->>'name', '') ELSE p.name END,
      code = CASE WHEN p_payload ? 'code' THEN NULLIF(p_payload->>'code', '') ELSE p.code END,
      price = CASE WHEN p_payload ? 'price' THEN NULLIF(p_payload->>'price', '')::numeric ELSE p.price END,
      budget_percentage = CASE WHEN p_payload ? 'budget_percentage' THEN NULLIF(p_payload->>'budget_percentage', '')::numeric ELSE p.budget_percentage END,
      overhead_percentage = CASE WHEN p_payload ? 'overhead_percentage' THEN NULLIF(p_payload->>'overhead_percentage', '')::numeric ELSE p.overhead_percentage END,
      type = CASE WHEN p_payload ? 'type' THEN COALESCE(NULLIF(p_payload->>'type', ''), 'Ostatní') ELSE p.type END,
      created_by_member_id = CASE WHEN p_payload ? 'created_by_member_id' THEN NULLIF(p_payload->>'created_by_member_id', '')::uuid ELSE p.created_by_member_id END,
      completion_date = CASE WHEN p_payload ? 'completion_date' THEN NULLIF(p_payload->>'completion_date', '')::date ELSE p.completion_date END,
      brief = CASE WHEN p_payload ? 'brief' THEN NULLIF(p_payload->>'brief', '') ELSE p.brief END,
      template_id = CASE WHEN p_payload ? 'template_id' THEN NULLIF(p_payload->>'template_id', '')::uuid ELSE p.template_id END,
      start_date = CASE WHEN p_payload ? 'start_date' THEN NULLIF(p_payload->>'start_date', '')::date ELSE p.start_date END,
      shared_drive_link = CASE WHEN p_payload ? 'shared_drive_link' THEN NULLIF(p_payload->>'shared_drive_link', '') ELSE p.shared_drive_link END,
      stage_id = CASE WHEN p_payload ? 'stage_id' THEN NULLIF(p_payload->>'stage_id', '')::uuid ELSE p.stage_id END,
      location = CASE WHEN p_payload ? 'location' THEN NULLIF(p_payload->>'location', '') ELSE p.location END,
      client_internal_ref = CASE WHEN p_payload ? 'client_internal_ref' THEN NULLIF(p_payload->>'client_internal_ref', '') ELSE p.client_internal_ref END,
      is_priority = CASE WHEN p_payload ? 'is_priority' THEN COALESCE((p_payload->>'is_priority')::boolean, false) ELSE p.is_priority END,
      location_coordinates = CASE WHEN p_payload ? 'location_coordinates' THEN NULLIF(p_payload->>'location_coordinates', '') ELSE p.location_coordinates END,
      brief_editable = CASE WHEN p_payload ? 'brief_editable' THEN NULLIF(p_payload->>'brief_editable', '') ELSE p.brief_editable END,
      investor_id = CASE WHEN p_payload ? 'investor_id' THEN NULLIF(p_payload->>'investor_id', '')::uuid ELSE p.investor_id END,
      client_id = CASE WHEN p_payload ? 'client_id' THEN NULLIF(p_payload->>'client_id', '')::uuid ELSE p.client_id END,
      crm_opportunity_id = CASE WHEN p_payload ? 'crm_opportunity_id' THEN NULLIF(p_payload->>'crm_opportunity_id', '')::uuid ELSE p.crm_opportunity_id END
    WHERE p.id = v_project_id
    RETURNING * INTO v_project;

    IF v_project.id IS NULL THEN
      RAISE EXCEPTION 'Project not found';
    END IF;

    IF p_next_status IS NOT NULL AND p_next_status <> v_project.status THEN
      SELECT * INTO v_project
      FROM public.update_project_status(v_project.id, p_next_status, 'project_form_update');
    END IF;
  END IF;

  RETURN to_jsonb(v_project);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_projects_batch_safe(p_projects jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_created jsonb := '[]'::jsonb;
  v_project jsonb;
BEGIN
  IF NOT public.can_manage_project_financials() THEN
    RAISE EXCEPTION 'Not allowed to create projects';
  END IF;

  IF jsonb_typeof(p_projects) <> 'array' THEN
    RAISE EXCEPTION 'projects payload must be an array';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_projects)
  LOOP
    v_project := public.save_project_safe(NULL, v_item, NULL);
    v_created := v_created || jsonb_build_array(v_project);
  END LOOP;

  RETURN v_created;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_project_member_safe(
  p_project_id uuid,
  p_assignment_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.project_members;
BEGIN
  IF NOT public.can_manage_project_financials() THEN
    RAISE EXCEPTION 'Not allowed to save project member';
  END IF;

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required';
  END IF;

  IF p_assignment_id IS NULL THEN
    INSERT INTO public.project_members (
      project_id,
      member_id,
      reward_percentage,
      reward_amount,
      reward_type,
      is_hourly
    )
    VALUES (
      p_project_id,
      NULLIF(p_payload->>'member_id', '')::uuid,
      NULLIF(p_payload->>'reward_percentage', '')::numeric,
      NULLIF(p_payload->>'reward_amount', '')::numeric,
      NULLIF(p_payload->>'reward_type', ''),
      COALESCE((p_payload->>'is_hourly')::boolean, false)
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.project_members pm
    SET
      member_id = CASE WHEN p_payload ? 'member_id' THEN NULLIF(p_payload->>'member_id', '')::uuid ELSE pm.member_id END,
      reward_percentage = CASE WHEN p_payload ? 'reward_percentage' THEN NULLIF(p_payload->>'reward_percentage', '')::numeric ELSE pm.reward_percentage END,
      reward_amount = CASE WHEN p_payload ? 'reward_amount' THEN NULLIF(p_payload->>'reward_amount', '')::numeric ELSE pm.reward_amount END,
      reward_type = CASE WHEN p_payload ? 'reward_type' THEN NULLIF(p_payload->>'reward_type', '') ELSE pm.reward_type END,
      is_hourly = CASE WHEN p_payload ? 'is_hourly' THEN COALESCE((p_payload->>'is_hourly')::boolean, false) ELSE pm.is_hourly END
    WHERE pm.id = p_assignment_id
      AND pm.project_id = p_project_id
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Project member assignment not found';
    END IF;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_project_subcontractor_safe(
  p_project_id uuid,
  p_assignment_id uuid DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.project_subcontractors;
BEGIN
  IF NOT public.can_manage_project_financials() THEN
    RAISE EXCEPTION 'Not allowed to save project subcontractor';
  END IF;

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'project_id is required';
  END IF;

  IF p_assignment_id IS NULL THEN
    INSERT INTO public.project_subcontractors (
      project_id,
      subject_id,
      scope_of_work,
      status,
      price
    )
    VALUES (
      p_project_id,
      NULLIF(p_payload->>'subject_id', '')::uuid,
      NULLIF(p_payload->>'scope_of_work', ''),
      COALESCE(NULLIF(p_payload->>'status', ''), 'pending'),
      NULLIF(p_payload->>'price', '')::numeric
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.project_subcontractors ps
    SET
      subject_id = CASE WHEN p_payload ? 'subject_id' THEN NULLIF(p_payload->>'subject_id', '')::uuid ELSE ps.subject_id END,
      scope_of_work = CASE WHEN p_payload ? 'scope_of_work' THEN NULLIF(p_payload->>'scope_of_work', '') ELSE ps.scope_of_work END,
      status = CASE WHEN p_payload ? 'status' THEN COALESCE(NULLIF(p_payload->>'status', ''), 'pending') ELSE ps.status END,
      price = CASE WHEN p_payload ? 'price' THEN NULLIF(p_payload->>'price', '')::numeric ELSE ps.price END
    WHERE ps.id = p_assignment_id
      AND ps.project_id = p_project_id
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Project subcontractor assignment not found';
    END IF;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_project_member_safe(p_project_id uuid, p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_project_financials() THEN
    RAISE EXCEPTION 'Not allowed to delete project member';
  END IF;

  DELETE FROM public.project_members
  WHERE id = p_assignment_id
    AND project_id = p_project_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_project_subcontractor_safe(p_project_id uuid, p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_project_financials() THEN
    RAISE EXCEPTION 'Not allowed to delete project subcontractor';
  END IF;

  DELETE FROM public.project_subcontractors
  WHERE id = p_assignment_id
    AND project_id = p_project_id;
END;
$$;

DROP POLICY IF EXISTS "Project members insert access" ON public.project_members;
DROP POLICY IF EXISTS "Project members update access" ON public.project_members;
DROP POLICY IF EXISTS "Project members delete access" ON public.project_members;

DROP POLICY IF EXISTS "Enable insert for project members or admins" ON public.project_subcontractors;
DROP POLICY IF EXISTS "Enable update for project members or admins" ON public.project_subcontractors;
DROP POLICY IF EXISTS "Enable delete for admins" ON public.project_subcontractors;

REVOKE ALL ON FUNCTION public.can_manage_project_financials() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_project_safe(uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_projects_batch_safe(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_project_member_safe(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_project_subcontractor_safe(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_project_member_safe(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_project_subcontractor_safe(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_manage_project_financials() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_project_safe(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_projects_batch_safe(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_project_member_safe(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_project_subcontractor_safe(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_member_safe(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project_subcontractor_safe(uuid, uuid) TO authenticated;
