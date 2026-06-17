CREATE OR REPLACE FUNCTION public.update_project_status(
  p_project_id uuid,
  p_next_status text,
  p_note text DEFAULT NULL
)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project public.projects;
  v_updated public.projects;
  v_allowed_statuses text[] := ARRAY[
    'nabidka',
    'active',
    'ready_for_delivery',
    'delivered',
    'closed'
  ];
BEGIN
  IF NOT public.can_edit_module('projects') THEN
    RAISE EXCEPTION 'Nemáte oprávnění měnit stav projektu.';
  END IF;

  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'Projekt není určen.';
  END IF;

  IF p_next_status IS NULL OR NOT p_next_status = ANY(v_allowed_statuses) THEN
    RAISE EXCEPTION 'Neplatný stav projektu: %', COALESCE(p_next_status, '(prázdný)');
  END IF;

  SELECT *
  INTO v_project
  FROM public.projects
  WHERE id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projekt nebyl nalezen.';
  END IF;

  IF v_project.status IS NOT DISTINCT FROM p_next_status THEN
    RETURN v_project;
  END IF;

  UPDATE public.projects
  SET status = p_next_status
  WHERE id = p_project_id
  RETURNING * INTO v_updated;

  PERFORM public.log_workflow_audit(
    'update_project_status',
    jsonb_build_object(
      'table', 'projects',
      'id', v_updated.id,
      'project_id', v_updated.id,
      'old_status', v_project.status,
      'new_status', v_updated.status,
      'note', p_note
    )
  );

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_realization_status(
  p_realization_id uuid,
  p_next_status text,
  p_note text DEFAULT NULL
)
RETURNS public.realizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_realization public.realizations;
  v_updated public.realizations;
  v_allowed_statuses text[] := ARRAY[
    'Připravuje se',
    'Probíhá',
    'Pozastaveno',
    'Dokončeno',
    'Předáno',
    'waiting_for_approval'
  ];
BEGIN
  IF NOT public.can_edit_module('realizace') THEN
    RAISE EXCEPTION 'Nemáte oprávnění měnit stav realizace.';
  END IF;

  IF p_realization_id IS NULL THEN
    RAISE EXCEPTION 'Realizace není určena.';
  END IF;

  IF p_next_status IS NULL OR NOT p_next_status = ANY(v_allowed_statuses) THEN
    RAISE EXCEPTION 'Neplatný stav realizace: %', COALESCE(p_next_status, '(prázdný)');
  END IF;

  SELECT *
  INTO v_realization
  FROM public.realizations
  WHERE id = p_realization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Realizace nebyla nalezena.';
  END IF;

  IF v_realization.status IS NOT DISTINCT FROM p_next_status THEN
    RETURN v_realization;
  END IF;

  UPDATE public.realizations
  SET status = p_next_status,
      updated_at = now()
  WHERE id = p_realization_id
  RETURNING * INTO v_updated;

  PERFORM public.log_workflow_audit(
    'realization_status_update',
    jsonb_build_object(
      'table', 'realizations',
      'id', v_updated.id,
      'realization_id', v_updated.id,
      'old_status', v_realization.status,
      'new_status', v_updated.status,
      'note', p_note
    )
  );

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.update_project_status(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_project_status(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.update_realization_status(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_realization_status(uuid, text, text) FROM anon;

GRANT EXECUTE ON FUNCTION public.update_project_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_realization_status(uuid, text, text) TO authenticated;
