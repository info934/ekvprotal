-- Reduce broad FOR ALL RLS policies that overlap read policies.
-- Where a broad policy was still needed for writes, split it into INSERT/UPDATE/DELETE.

DROP POLICY IF EXISTS "Admin full access" ON public.project_stages;
DROP POLICY IF EXISTS "Enable all for admins" ON public.project_stages;
CREATE POLICY "Project stages insert for admins" ON public.project_stages
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Project stages update for admins" ON public.project_stages
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin')
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Project stages delete for admins" ON public.project_stages
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin full access" ON public.project_tags;
DROP POLICY IF EXISTS "Enable all for admins" ON public.project_tags;
CREATE POLICY "Project tags insert for admins" ON public.project_tags
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Project tags update for admins" ON public.project_tags
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin')
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Project tags delete for admins" ON public.project_tags
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');

DROP POLICY IF EXISTS "Admin full access" ON public.project_subcontractors;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.engineering_activities;
DROP POLICY IF EXISTS "Admin full access" ON public.engineering_subjects;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.project_contacts;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.project_costs;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.project_to_tags;
DROP POLICY IF EXISTS "Enable full access for admins on realizations" ON public.realizations;

DROP POLICY IF EXISTS "Allow admins full access" ON public.documents;
DROP POLICY IF EXISTS "Allow project members with edit permission to manage" ON public.documents;
CREATE POLICY "Allow project members with edit permission to delete"
ON public.documents
FOR DELETE
TO authenticated
USING (
  get_user_role() = 'admin'
  OR (
    (
      SELECT role_permissions.can_edit
      FROM public.role_permissions
      WHERE role_permissions.role = get_user_role()
        AND role_permissions.module = 'documents'
    )
    AND project_id IN (
      SELECT project_members.project_id
      FROM public.project_members
      WHERE project_members.member_id = get_member_id()
    )
  )
);

DROP POLICY IF EXISTS "Enable all for admins" ON public.member_certifications;
DROP POLICY IF EXISTS "Enable insert/update/delete for own records" ON public.member_certifications;
CREATE POLICY "Member certifications insert for admins"
ON public.member_certifications
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Member certifications update for admins"
ON public.member_certifications
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin')
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Member certifications delete for admins"
ON public.member_certifications
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');
CREATE POLICY "Member certifications insert for own records"
ON public.member_certifications
FOR INSERT TO authenticated
WITH CHECK (
  member_id = (
    SELECT m.id
    FROM public.members m
    WHERE m.auth_user_id = (SELECT auth.uid())
  )
);
CREATE POLICY "Member certifications update for own records"
ON public.member_certifications
FOR UPDATE TO authenticated
USING (
  member_id = (
    SELECT m.id
    FROM public.members m
    WHERE m.auth_user_id = (SELECT auth.uid())
  )
);
CREATE POLICY "Member certifications delete for own records"
ON public.member_certifications
FOR DELETE TO authenticated
USING (
  member_id = (
    SELECT m.id
    FROM public.members m
    WHERE m.auth_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "Admins can manage all templates" ON public.project_templates_custom;
DROP POLICY IF EXISTS "Users can manage their own templates" ON public.project_templates_custom;
CREATE POLICY "Project custom templates insert for admins"
ON public.project_templates_custom
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');
CREATE POLICY "Project custom templates update for admins"
ON public.project_templates_custom
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin');
CREATE POLICY "Project custom templates delete for admins"
ON public.project_templates_custom
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');
CREATE POLICY "Project custom templates insert for owners"
ON public.project_templates_custom
FOR INSERT TO authenticated
WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "Project custom templates update for owners"
ON public.project_templates_custom
FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Project custom templates delete for owners"
ON public.project_templates_custom
FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()));
