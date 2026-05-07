-- Core CRM entities. These extend existing subjects/projects instead of duplicating them.

CREATE TABLE IF NOT EXISTS public.crm_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  owner_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  title text NOT NULL,
  stage text NOT NULL DEFAULT 'lead',
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'medium',
  source text,
  value numeric(14, 2) NOT NULL DEFAULT 0,
  probability integer NOT NULL DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
  expected_close_date date,
  next_step text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  assigned_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'note',
  status text NOT NULL DEFAULT 'planned',
  title text NOT NULL,
  description text,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opportunity_id IS NOT NULL OR subject_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.crm_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE CASCADE,
  author_member_id uuid REFERENCES public.members(id) ON DELETE SET NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opportunity_id IS NOT NULL OR subject_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_crm_opportunities_subject_id ON public.crm_opportunities(subject_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_project_id ON public.crm_opportunities(project_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_owner_member_id ON public.crm_opportunities(owner_member_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_stage ON public.crm_opportunities(stage);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_status ON public.crm_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_crm_activities_opportunity_id ON public.crm_activities(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_subject_id ON public.crm_activities(subject_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_assigned_member_id ON public.crm_activities(assigned_member_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_due_at ON public.crm_activities(due_at);
CREATE INDEX IF NOT EXISTS idx_crm_notes_opportunity_id ON public.crm_notes(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_crm_notes_subject_id ON public.crm_notes(subject_id);

CREATE OR REPLACE FUNCTION public.update_crm_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_crm_opportunities_updated_at ON public.crm_opportunities;
CREATE TRIGGER update_crm_opportunities_updated_at
BEFORE UPDATE ON public.crm_opportunities
FOR EACH ROW EXECUTE FUNCTION public.update_crm_updated_at();

DROP TRIGGER IF EXISTS update_crm_activities_updated_at ON public.crm_activities;
CREATE TRIGGER update_crm_activities_updated_at
BEFORE UPDATE ON public.crm_activities
FOR EACH ROW EXECUTE FUNCTION public.update_crm_updated_at();

DROP TRIGGER IF EXISTS update_crm_notes_updated_at ON public.crm_notes;
CREATE TRIGGER update_crm_notes_updated_at
BEFORE UPDATE ON public.crm_notes
FOR EACH ROW EXECUTE FUNCTION public.update_crm_updated_at();

ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CRM read access" ON public.crm_opportunities;
CREATE POLICY "CRM read access"
ON public.crm_opportunities
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

DROP POLICY IF EXISTS "CRM edit access" ON public.crm_opportunities;
CREATE POLICY "CRM edit access"
ON public.crm_opportunities
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR owner_member_id = get_member_id()
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_edit = true
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR owner_member_id = get_member_id()
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_edit = true
  )
);

DROP POLICY IF EXISTS "CRM activities read access" ON public.crm_activities;
CREATE POLICY "CRM activities read access"
ON public.crm_activities
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

DROP POLICY IF EXISTS "CRM activities edit access" ON public.crm_activities;
CREATE POLICY "CRM activities edit access"
ON public.crm_activities
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR assigned_member_id = get_member_id()
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_edit = true
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR assigned_member_id = get_member_id()
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_edit = true
  )
);

DROP POLICY IF EXISTS "CRM notes read access" ON public.crm_notes;
CREATE POLICY "CRM notes read access"
ON public.crm_notes
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

DROP POLICY IF EXISTS "CRM notes edit access" ON public.crm_notes;
CREATE POLICY "CRM notes edit access"
ON public.crm_notes
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR author_member_id = get_member_id()
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_edit = true
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR author_member_id = get_member_id()
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_edit = true
  )
);
