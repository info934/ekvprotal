DROP FUNCTION IF EXISTS public.list_project_subcontractors_safe(uuid);

CREATE OR REPLACE FUNCTION public.list_project_subcontractors_safe(p_project_id uuid)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  subject_id uuid,
  scope_of_work text,
  status text,
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
    ps.status,
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

REVOKE ALL ON FUNCTION public.list_project_subcontractors_safe(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_project_subcontractors_safe(uuid) TO authenticated;
