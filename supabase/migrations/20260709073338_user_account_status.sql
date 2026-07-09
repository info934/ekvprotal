CREATE TABLE IF NOT EXISTS public.user_account_status (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  reason text,
  deactivated_at timestamptz,
  deactivated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reactivated_at timestamptz,
  reactivated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_account_status_status ON public.user_account_status(status);
CREATE INDEX IF NOT EXISTS idx_user_account_status_deactivated_by ON public.user_account_status(deactivated_by);

ALTER TABLE public.user_account_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own account status" ON public.user_account_status;
DROP POLICY IF EXISTS "Admins can read account statuses" ON public.user_account_status;
DROP POLICY IF EXISTS "Admins can manage account statuses" ON public.user_account_status;

CREATE POLICY "Users can read own account status"
ON public.user_account_status
FOR SELECT
TO authenticated
USING ((select auth.uid()) = auth_user_id);

CREATE POLICY "Admins can read account statuses"
ON public.user_account_status
FOR SELECT
TO authenticated
USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins can manage account statuses"
ON public.user_account_status
FOR ALL
TO authenticated
USING (public.get_user_role() = 'admin')
WITH CHECK (public.get_user_role() = 'admin');

REVOKE ALL ON public.user_account_status FROM anon;
REVOKE ALL ON public.user_account_status FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_account_status TO authenticated;
GRANT ALL ON public.user_account_status TO service_role;

CREATE OR REPLACE FUNCTION public.set_user_account_status_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_user_account_status_updated_at ON public.user_account_status;
CREATE TRIGGER tr_user_account_status_updated_at
BEFORE UPDATE ON public.user_account_status
FOR EACH ROW
EXECUTE FUNCTION public.set_user_account_status_updated_at();