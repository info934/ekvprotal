CREATE TABLE IF NOT EXISTS public.workflow_email_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  workflow_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  event_type text NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id text,
  error_message text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_email_deliveries_entity
  ON public.workflow_email_deliveries (entity_type, entity_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_email_deliveries_status
  ON public.workflow_email_deliveries (status, created_at DESC);

ALTER TABLE public.workflow_email_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read workflow email deliveries"
  ON public.workflow_email_deliveries;
CREATE POLICY "Admins can read workflow email deliveries"
  ON public.workflow_email_deliveries
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');

REVOKE ALL ON public.workflow_email_deliveries FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.workflow_email_deliveries FROM authenticated;
GRANT SELECT ON public.workflow_email_deliveries TO authenticated;
GRANT ALL ON public.workflow_email_deliveries TO service_role;

CREATE OR REPLACE FUNCTION public.increment_workflow_email_attempt(p_delivery_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.workflow_email_deliveries
     SET attempts = attempts + 1,
         updated_at = now()
   WHERE id = p_delivery_id;
$$;

REVOKE ALL ON FUNCTION public.increment_workflow_email_attempt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_workflow_email_attempt(uuid) TO service_role;

COMMENT ON TABLE public.workflow_email_deliveries IS
  'Server-side delivery evidence and idempotency for workflow notification emails.';

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_payout_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_payouts_updated_at ON public.payouts;
CREATE TRIGGER tr_payouts_updated_at
BEFORE UPDATE ON public.payouts
FOR EACH ROW EXECUTE FUNCTION public.set_payout_updated_at();
