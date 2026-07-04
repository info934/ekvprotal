ALTER TABLE public.crm_opportunities
  ADD COLUMN IF NOT EXISTS cancelled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS archived_reason text,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS deleted_reason text,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.crm_commercial_documents
  ADD COLUMN IF NOT EXISTS cancelled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS archived_reason text,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS deleted_reason text,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.crm_commercial_documents
  DROP CONSTRAINT IF EXISTS crm_commercial_documents_status_check;

ALTER TABLE public.crm_commercial_documents
  ADD CONSTRAINT crm_commercial_documents_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'rejected'::text, 'cancelled'::text, 'closed'::text, 'deleted'::text]));

CREATE INDEX IF NOT EXISTS idx_crm_opportunities_deleted_at
  ON public.crm_opportunities (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_opportunities_cancelled_at
  ON public.crm_opportunities (cancelled_at)
  WHERE cancelled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_commercial_documents_deleted_at
  ON public.crm_commercial_documents (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_commercial_documents_cancelled_at
  ON public.crm_commercial_documents (cancelled_at)
  WHERE cancelled_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_cancel_opportunity(
  p_opportunity_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS public.crm_opportunities
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after public.crm_opportunities;
  v_reason text := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
BEGIN
  SELECT TO_JSONB(o)
    INTO v_before
  FROM public.crm_opportunities o
  WHERE o.id = p_opportunity_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'CRM opportunity % not found', p_opportunity_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.crm_opportunities
  SET
    stage = 'lost',
    status = 'cancelled',
    probability = 0,
    lost_reason = COALESCE(NULLIF(lost_reason, ''), v_reason, 'Stornovano'),
    lost_at = COALESCE(lost_at, NOW()),
    cancelled_at = COALESCE(cancelled_at, NOW()),
    cancelled_reason = COALESCE(v_reason, cancelled_reason),
    cancelled_by = COALESCE(cancelled_by, auth.uid()),
    updated_at = NOW()
  WHERE id = p_opportunity_id
    AND deleted_at IS NULL
  RETURNING * INTO v_after;

  IF v_after.id IS NULL THEN
    RAISE EXCEPTION 'CRM opportunity % could not be cancelled', p_opportunity_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, user_email, action, details)
  VALUES (
    auth.uid(),
    COALESCE(auth.jwt() ->> 'email', ''),
    'crm_opportunity_cancelled',
    JSONB_BUILD_OBJECT(
      'entity', 'crm_opportunity',
      'id', p_opportunity_id,
      'number', v_after.number,
      'title', v_after.title,
      'reason', v_reason,
      'before', v_before,
      'after', TO_JSONB(v_after)
    )
  );

  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_soft_delete_opportunity(
  p_opportunity_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS public.crm_opportunities
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after public.crm_opportunities;
  v_reason text := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
BEGIN
  SELECT TO_JSONB(o)
    INTO v_before
  FROM public.crm_opportunities o
  WHERE o.id = p_opportunity_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'CRM opportunity % not found', p_opportunity_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.crm_opportunities
  SET
    status = 'deleted',
    deleted_at = COALESCE(deleted_at, NOW()),
    deleted_reason = COALESCE(v_reason, deleted_reason),
    deleted_by = COALESCE(deleted_by, auth.uid()),
    updated_at = NOW()
  WHERE id = p_opportunity_id
    AND deleted_at IS NULL
  RETURNING * INTO v_after;

  IF v_after.id IS NULL THEN
    RAISE EXCEPTION 'CRM opportunity % could not be removed', p_opportunity_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, user_email, action, details)
  VALUES (
    auth.uid(),
    COALESCE(auth.jwt() ->> 'email', ''),
    'crm_opportunity_soft_deleted',
    JSONB_BUILD_OBJECT(
      'entity', 'crm_opportunity',
      'id', p_opportunity_id,
      'number', v_after.number,
      'title', v_after.title,
      'reason', v_reason,
      'before', v_before,
      'after', TO_JSONB(v_after)
    )
  );

  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_cancel_commercial_document(
  p_document_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS public.crm_commercial_documents
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after public.crm_commercial_documents;
  v_reason text := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
BEGIN
  SELECT TO_JSONB(d)
    INTO v_before
  FROM public.crm_commercial_documents d
  WHERE d.id = p_document_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'CRM commercial document % not found', p_document_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.crm_commercial_documents
  SET
    status = 'cancelled',
    cancelled_at = COALESCE(cancelled_at, NOW()),
    cancelled_reason = COALESCE(v_reason, cancelled_reason),
    cancelled_by = COALESCE(cancelled_by, auth.uid()),
    updated_at = NOW()
  WHERE id = p_document_id
    AND deleted_at IS NULL
  RETURNING * INTO v_after;

  IF v_after.id IS NULL THEN
    RAISE EXCEPTION 'CRM commercial document % could not be cancelled', p_document_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, user_email, action, details)
  VALUES (
    auth.uid(),
    COALESCE(auth.jwt() ->> 'email', ''),
    'crm_commercial_document_cancelled',
    JSONB_BUILD_OBJECT(
      'entity', 'crm_commercial_document',
      'id', p_document_id,
      'type', v_after.type,
      'number', v_after.number,
      'title', v_after.title,
      'reason', v_reason,
      'before', v_before,
      'after', TO_JSONB(v_after)
    )
  );

  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_soft_delete_commercial_document(
  p_document_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS public.crm_commercial_documents
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after public.crm_commercial_documents;
  v_reason text := NULLIF(BTRIM(COALESCE(p_reason, '')), '');
BEGIN
  SELECT TO_JSONB(d)
    INTO v_before
  FROM public.crm_commercial_documents d
  WHERE d.id = p_document_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'CRM commercial document % not found', p_document_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.crm_commercial_documents
  SET
    status = 'deleted',
    deleted_at = COALESCE(deleted_at, NOW()),
    deleted_reason = COALESCE(v_reason, deleted_reason),
    deleted_by = COALESCE(deleted_by, auth.uid()),
    updated_at = NOW()
  WHERE id = p_document_id
    AND deleted_at IS NULL
  RETURNING * INTO v_after;

  IF v_after.id IS NULL THEN
    RAISE EXCEPTION 'CRM commercial document % could not be removed', p_document_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, user_email, action, details)
  VALUES (
    auth.uid(),
    COALESCE(auth.jwt() ->> 'email', ''),
    'crm_commercial_document_soft_deleted',
    JSONB_BUILD_OBJECT(
      'entity', 'crm_commercial_document',
      'id', p_document_id,
      'type', v_after.type,
      'number', v_after.number,
      'title', v_after.title,
      'reason', v_reason,
      'before', v_before,
      'after', TO_JSONB(v_after)
    )
  );

  RETURN v_after;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_cancel_opportunity(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_soft_delete_opportunity(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_cancel_commercial_document(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_soft_delete_commercial_document(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.crm_cancel_opportunity(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_soft_delete_opportunity(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_cancel_commercial_document(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_soft_delete_commercial_document(uuid, text) TO authenticated;
