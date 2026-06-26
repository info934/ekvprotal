ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read for admins only" ON public.audit_logs;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.audit_logs;

CREATE POLICY "Enable read for admins only"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.get_user_role() = 'admin');

CREATE POLICY "Enable insert for authenticated users"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

REVOKE ALL ON public.audit_logs FROM anon;
REVOKE ALL ON public.audit_logs FROM authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
