-- Continue reducing multiple permissive RLS policies by removing broad
-- admin/public read overlap while preserving authenticated app access.

-- App/settings dictionaries: authenticated reads, admins write.
DROP POLICY IF EXISTS "Enable read access for all users" ON public.app_settings;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.app_settings;
DROP POLICY IF EXISTS "Enable update for admins" ON public.app_settings;
DROP POLICY IF EXISTS "App settings update for admins" ON public.app_settings;
CREATE POLICY "App settings update for admins"
ON public.app_settings
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin')
WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Enable read access for all users" ON public.role_permissions;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.role_permissions;
DROP POLICY IF EXISTS "Enable all for admins" ON public.role_permissions;
DROP POLICY IF EXISTS "Role permissions insert for admins" ON public.role_permissions;
DROP POLICY IF EXISTS "Role permissions update for admins" ON public.role_permissions;
DROP POLICY IF EXISTS "Role permissions delete for admins" ON public.role_permissions;
CREATE POLICY "Role permissions insert for admins"
ON public.role_permissions
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Role permissions update for admins"
ON public.role_permissions
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin')
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Role permissions delete for admins"
ON public.role_permissions
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Enable read access for all users" ON public.project_templates;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.project_templates;
DROP POLICY IF EXISTS "Enable insert for admins" ON public.project_templates;
DROP POLICY IF EXISTS "Enable update for admins" ON public.project_templates;
DROP POLICY IF EXISTS "Enable delete for admins" ON public.project_templates;
DROP POLICY IF EXISTS "Project templates insert for admins" ON public.project_templates;
DROP POLICY IF EXISTS "Project templates update for admins" ON public.project_templates;
DROP POLICY IF EXISTS "Project templates delete for admins" ON public.project_templates;
CREATE POLICY "Project templates insert for admins" ON public.project_templates
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Project templates update for admins" ON public.project_templates
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin')
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Project templates delete for admins" ON public.project_templates
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Enable read access for all users" ON public.subject_types;
DROP POLICY IF EXISTS "Admin full access" ON public.subject_types;
DROP POLICY IF EXISTS "Enable all for admins" ON public.subject_types;
DROP POLICY IF EXISTS "Subject types insert for admins" ON public.subject_types;
DROP POLICY IF EXISTS "Subject types update for admins" ON public.subject_types;
DROP POLICY IF EXISTS "Subject types delete for admins" ON public.subject_types;
CREATE POLICY "Subject types insert for admins" ON public.subject_types
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Subject types update for admins" ON public.subject_types
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin')
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Subject types delete for admins" ON public.subject_types
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Enable read access for all users" ON public.task_statuses;
DROP POLICY IF EXISTS "Admin full access" ON public.task_statuses;
DROP POLICY IF EXISTS "Enable all for admins" ON public.task_statuses;
DROP POLICY IF EXISTS "Task statuses insert for admins" ON public.task_statuses;
DROP POLICY IF EXISTS "Task statuses update for admins" ON public.task_statuses;
DROP POLICY IF EXISTS "Task statuses delete for admins" ON public.task_statuses;
CREATE POLICY "Task statuses insert for admins" ON public.task_statuses
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Task statuses update for admins" ON public.task_statuses
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin')
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Task statuses delete for admins" ON public.task_statuses
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Enable read access for all users" ON public.subjects;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.subjects;
DROP POLICY IF EXISTS "Enable all for admins" ON public.subjects;
DROP POLICY IF EXISTS "Subjects insert for admins" ON public.subjects;
DROP POLICY IF EXISTS "Subjects update for admins" ON public.subjects;
DROP POLICY IF EXISTS "Subjects delete for admins" ON public.subjects;
CREATE POLICY "Subjects insert for admins" ON public.subjects
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Subjects update for admins" ON public.subjects
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin')
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Subjects delete for admins" ON public.subjects
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');

-- Workflow tables: remove broad admin policies covered by specific rules.
DROP POLICY IF EXISTS "Enable full access for admins" ON public.attendance;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.payouts;
DROP POLICY IF EXISTS "Enable update for admins" ON public.payouts;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.project_tasks;

DROP POLICY IF EXISTS "Enable update/delete for admins only" ON public.members;
DROP POLICY IF EXISTS "Members insert for admins" ON public.members;
DROP POLICY IF EXISTS "Members update for admins" ON public.members;
DROP POLICY IF EXISTS "Members delete for admins" ON public.members;
CREATE POLICY "Members insert for admins"
ON public.members
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Members update for admins"
ON public.members
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin')
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Members delete for admins"
ON public.members
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');

-- Realization financial tables have a legacy `realizace` permission module.
-- Split broad write policies so they no longer act as duplicate SELECT policies.
DROP POLICY IF EXISTS "Enable full access for admins on realizace_financials" ON public.realizace_financials;
DROP POLICY IF EXISTS "Enable insert/update for realizace editors" ON public.realizace_financials;
DROP POLICY IF EXISTS "Realizace financials insert for admins" ON public.realizace_financials;
DROP POLICY IF EXISTS "Realizace financials update for admins" ON public.realizace_financials;
DROP POLICY IF EXISTS "Realizace financials delete for admins" ON public.realizace_financials;
DROP POLICY IF EXISTS "Realizace financials insert for editors" ON public.realizace_financials;
DROP POLICY IF EXISTS "Realizace financials update for editors" ON public.realizace_financials;
CREATE POLICY "Realizace financials insert for admins" ON public.realizace_financials
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Realizace financials update for admins" ON public.realizace_financials
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin');
CREATE POLICY "Realizace financials delete for admins" ON public.realizace_financials
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');
CREATE POLICY "Realizace financials insert for editors" ON public.realizace_financials
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
  FROM public.role_permissions
  WHERE role_permissions.role = get_user_role()
    AND role_permissions.module = 'realizace'
      AND role_permissions.can_edit = true
  )
);
CREATE POLICY "Realizace financials update for editors" ON public.realizace_financials
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
  FROM public.role_permissions
  WHERE role_permissions.role = get_user_role()
    AND role_permissions.module = 'realizace'
      AND role_permissions.can_edit = true
  )
);

DROP POLICY IF EXISTS "Enable full access for admins on realizace_overhead" ON public.realizace_overhead;
DROP POLICY IF EXISTS "Enable insert/update for realizace editors" ON public.realizace_overhead;
DROP POLICY IF EXISTS "Realizace overhead insert for admins" ON public.realizace_overhead;
DROP POLICY IF EXISTS "Realizace overhead update for admins" ON public.realizace_overhead;
DROP POLICY IF EXISTS "Realizace overhead delete for admins" ON public.realizace_overhead;
DROP POLICY IF EXISTS "Realizace overhead insert for editors" ON public.realizace_overhead;
DROP POLICY IF EXISTS "Realizace overhead update for editors" ON public.realizace_overhead;
CREATE POLICY "Realizace overhead insert for admins" ON public.realizace_overhead
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Realizace overhead update for admins" ON public.realizace_overhead
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin');
CREATE POLICY "Realizace overhead delete for admins" ON public.realizace_overhead
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');
CREATE POLICY "Realizace overhead insert for editors" ON public.realizace_overhead
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
  FROM public.role_permissions
  WHERE role_permissions.role = get_user_role()
    AND role_permissions.module = 'realizace'
      AND role_permissions.can_edit = true
  )
);
CREATE POLICY "Realizace overhead update for editors" ON public.realizace_overhead
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
  FROM public.role_permissions
  WHERE role_permissions.role = get_user_role()
    AND role_permissions.module = 'realizace'
      AND role_permissions.can_edit = true
  )
);
