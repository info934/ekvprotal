CREATE TABLE IF NOT EXISTS public.crm_stage_definitions (
  value text PRIMARY KEY,
  label text NOT NULL,
  color text NOT NULL DEFAULT 'bg-slate-100 text-slate-700 border-slate-200',
  probability integer NOT NULL DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_priority_definitions (
  value text PRIMARY KEY,
  label text NOT NULL,
  tone text NOT NULL DEFAULT 'secondary',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.crm_stage_definitions (value, label, color, probability, sort_order, is_closed)
VALUES
  ('lead', 'Lead', 'bg-slate-100 text-slate-700 border-slate-200', 10, 10, false),
  ('qualified', 'Kvalifikovano', 'bg-blue-100 text-blue-700 border-blue-200', 25, 20, false),
  ('proposal', 'Nabidka', 'bg-indigo-100 text-indigo-700 border-indigo-200', 45, 30, false),
  ('negotiation', 'Jednani', 'bg-amber-100 text-amber-800 border-amber-200', 70, 40, false),
  ('won', 'Vyhrano', 'bg-emerald-100 text-emerald-700 border-emerald-200', 100, 50, true),
  ('lost', 'Ztraceno', 'bg-rose-100 text-rose-700 border-rose-200', 0, 60, true)
ON CONFLICT (value) DO NOTHING;

INSERT INTO public.crm_priority_definitions (value, label, tone, sort_order)
VALUES
  ('low', 'Nizka', 'secondary', 10),
  ('medium', 'Stredni', 'outline', 20),
  ('high', 'Vysoka', 'destructive', 30)
ON CONFLICT (value) DO NOTHING;

DROP TRIGGER IF EXISTS update_crm_stage_definitions_updated_at ON public.crm_stage_definitions;
CREATE TRIGGER update_crm_stage_definitions_updated_at
BEFORE UPDATE ON public.crm_stage_definitions
FOR EACH ROW EXECUTE FUNCTION public.update_crm_updated_at();

DROP TRIGGER IF EXISTS update_crm_priority_definitions_updated_at ON public.crm_priority_definitions;
CREATE TRIGGER update_crm_priority_definitions_updated_at
BEFORE UPDATE ON public.crm_priority_definitions
FOR EACH ROW EXECUTE FUNCTION public.update_crm_updated_at();

ALTER TABLE public.crm_stage_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_priority_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CRM stage definitions read access" ON public.crm_stage_definitions;
CREATE POLICY "CRM stage definitions read access"
ON public.crm_stage_definitions
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_read = true
  )
);

DROP POLICY IF EXISTS "CRM stage definitions admin access" ON public.crm_stage_definitions;
CREATE POLICY "CRM stage definitions admin access"
ON public.crm_stage_definitions
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_admin = true
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_admin = true
  )
);

DROP POLICY IF EXISTS "CRM priority definitions read access" ON public.crm_priority_definitions;
CREATE POLICY "CRM priority definitions read access"
ON public.crm_priority_definitions
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_read = true
  )
);

DROP POLICY IF EXISTS "CRM priority definitions admin access" ON public.crm_priority_definitions;
CREATE POLICY "CRM priority definitions admin access"
ON public.crm_priority_definitions
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_admin = true
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_admin = true
  )
);
