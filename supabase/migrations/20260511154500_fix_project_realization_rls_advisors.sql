-- Fix Supabase advisor findings without changing the application permission model.
-- The online project currently has no `realizace` module in role_permissions,
-- so realization-related financial tables are guarded by the existing
-- `projects` permissions, with read access for payout workflows where needed.

CREATE INDEX IF NOT EXISTS idx_crm_activities_project_id
ON public.crm_activities (project_id);

CREATE INDEX IF NOT EXISTS idx_crm_notes_author_member_id
ON public.crm_notes (author_member_id);

DROP POLICY IF EXISTS "Authenticated users can manage project members" ON public.project_members;
DROP POLICY IF EXISTS "Project members read access" ON public.project_members;
DROP POLICY IF EXISTS "Project members edit access" ON public.project_members;
DROP POLICY IF EXISTS "Project members insert access" ON public.project_members;
DROP POLICY IF EXISTS "Project members update access" ON public.project_members;
DROP POLICY IF EXISTS "Project members delete access" ON public.project_members;

CREATE POLICY "Project members read access"
ON public.project_members
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND role_permissions.can_read = true
  )
);

CREATE POLICY "Project members insert access"
ON public.project_members
FOR INSERT
TO authenticated
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);

CREATE POLICY "Project members update access"
ON public.project_members
FOR UPDATE
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);

CREATE POLICY "Project members delete access"
ON public.project_members
FOR DELETE
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);

DROP POLICY IF EXISTS "Authenticated users can manage realizace extra costs" ON public.realizace_extra_costs;
DROP POLICY IF EXISTS "Realizace extra costs read access" ON public.realizace_extra_costs;
DROP POLICY IF EXISTS "Realizace extra costs edit access" ON public.realizace_extra_costs;
DROP POLICY IF EXISTS "Realizace extra costs insert access" ON public.realizace_extra_costs;
DROP POLICY IF EXISTS "Realizace extra costs update access" ON public.realizace_extra_costs;
DROP POLICY IF EXISTS "Realizace extra costs delete access" ON public.realizace_extra_costs;

CREATE POLICY "Realizace extra costs read access"
ON public.realizace_extra_costs
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND role_permissions.can_read = true
  )
);

CREATE POLICY "Realizace extra costs insert access"
ON public.realizace_extra_costs
FOR INSERT
TO authenticated
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);

CREATE POLICY "Realizace extra costs update access"
ON public.realizace_extra_costs
FOR UPDATE
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);

CREATE POLICY "Realizace extra costs delete access"
ON public.realizace_extra_costs
FOR DELETE
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);

DROP POLICY IF EXISTS "Authenticated users can manage realization profit shares" ON public.realization_profit_shares;
DROP POLICY IF EXISTS "Realization profit shares read access" ON public.realization_profit_shares;
DROP POLICY IF EXISTS "Realization profit shares edit access" ON public.realization_profit_shares;
DROP POLICY IF EXISTS "Realization profit shares insert access" ON public.realization_profit_shares;
DROP POLICY IF EXISTS "Realization profit shares update access" ON public.realization_profit_shares;
DROP POLICY IF EXISTS "Realization profit shares delete access" ON public.realization_profit_shares;

CREATE POLICY "Realization profit shares read access"
ON public.realization_profit_shares
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module IN ('projects', 'payouts')
      AND role_permissions.can_read = true
  )
);

CREATE POLICY "Realization profit shares insert access"
ON public.realization_profit_shares
FOR INSERT
TO authenticated
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);

CREATE POLICY "Realization profit shares update access"
ON public.realization_profit_shares
FOR UPDATE
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);

CREATE POLICY "Realization profit shares delete access"
ON public.realization_profit_shares
FOR DELETE
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'projects'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);
