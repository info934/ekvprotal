-- Merge remaining paired RLS policies that grant the same command to the same
-- role set through separate admin/owner/editor rules.

-- Prefer authenticated/member-scoped read policies over global public read.
DROP POLICY IF EXISTS "Enable read access for all users" ON public.engineering_activities;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.engineering_subjects;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.project_stages;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.project_tags;

-- Payouts: merge admin workflow update and own invoice upload into one update
-- policy to remove same-role permissive overlap.
DROP POLICY IF EXISTS "Enable admin workflow management" ON public.payouts;
DROP POLICY IF EXISTS "Enable invoice upload for own payouts" ON public.payouts;
DROP POLICY IF EXISTS "Payouts update for admins or own invoice upload" ON public.payouts;

CREATE POLICY "Payouts update for admins or own invoice upload"
ON public.payouts
FOR UPDATE TO authenticated
USING (
  get_user_role() = 'admin'
  OR member_id = get_member_id()
)
WITH CHECK (
  get_user_role() = 'admin'
  OR member_id = get_member_id()
);

-- Member certifications: admin and own-record policies are equivalent command
-- pairs, so keep one policy per write command.
DROP POLICY IF EXISTS "Member certifications insert for admins" ON public.member_certifications;
DROP POLICY IF EXISTS "Member certifications insert for own records" ON public.member_certifications;
DROP POLICY IF EXISTS "Member certifications update for admins" ON public.member_certifications;
DROP POLICY IF EXISTS "Member certifications update for own records" ON public.member_certifications;
DROP POLICY IF EXISTS "Member certifications delete for admins" ON public.member_certifications;
DROP POLICY IF EXISTS "Member certifications delete for own records" ON public.member_certifications;
DROP POLICY IF EXISTS "Member certifications insert for admins or own records" ON public.member_certifications;
DROP POLICY IF EXISTS "Member certifications update for admins or own records" ON public.member_certifications;
DROP POLICY IF EXISTS "Member certifications delete for admins or own records" ON public.member_certifications;

CREATE POLICY "Member certifications insert for admins or own records"
ON public.member_certifications
FOR INSERT TO authenticated
WITH CHECK (
  get_user_role() = 'admin'
  OR member_id = get_member_id()
);

CREATE POLICY "Member certifications update for admins or own records"
ON public.member_certifications
FOR UPDATE TO authenticated
USING (
  get_user_role() = 'admin'
  OR member_id = get_member_id()
)
WITH CHECK (
  get_user_role() = 'admin'
  OR member_id = get_member_id()
);

CREATE POLICY "Member certifications delete for admins or own records"
ON public.member_certifications
FOR DELETE TO authenticated
USING (
  get_user_role() = 'admin'
  OR member_id = get_member_id()
);

-- Custom project templates: merge admin and owner write policies.
DROP POLICY IF EXISTS "Project custom templates insert for admins" ON public.project_templates_custom;
DROP POLICY IF EXISTS "Project custom templates insert for owners" ON public.project_templates_custom;
DROP POLICY IF EXISTS "Project custom templates update for admins" ON public.project_templates_custom;
DROP POLICY IF EXISTS "Project custom templates update for owners" ON public.project_templates_custom;
DROP POLICY IF EXISTS "Project custom templates delete for admins" ON public.project_templates_custom;
DROP POLICY IF EXISTS "Project custom templates delete for owners" ON public.project_templates_custom;
DROP POLICY IF EXISTS "Project custom templates insert for admins or owners" ON public.project_templates_custom;
DROP POLICY IF EXISTS "Project custom templates update for admins or owners" ON public.project_templates_custom;
DROP POLICY IF EXISTS "Project custom templates delete for admins or owners" ON public.project_templates_custom;

CREATE POLICY "Project custom templates insert for admins or owners"
ON public.project_templates_custom
FOR INSERT TO authenticated
WITH CHECK (
  get_user_role() = 'admin'
  OR user_id = auth.uid()
);

CREATE POLICY "Project custom templates update for admins or owners"
ON public.project_templates_custom
FOR UPDATE TO authenticated
USING (
  get_user_role() = 'admin'
  OR user_id = auth.uid()
)
WITH CHECK (
  get_user_role() = 'admin'
  OR user_id = auth.uid()
);

CREATE POLICY "Project custom templates delete for admins or owners"
ON public.project_templates_custom
FOR DELETE TO authenticated
USING (
  get_user_role() = 'admin'
  OR user_id = auth.uid()
);

-- Project tags relation: split ALL into write-only policies and keep a single
-- member/admin SELECT policy.
DROP POLICY IF EXISTS "Enable all for admins or project members" ON public.project_to_tags;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.project_to_tags;
DROP POLICY IF EXISTS "Project to tags insert for admins or project members" ON public.project_to_tags;
DROP POLICY IF EXISTS "Project to tags update for admins or project members" ON public.project_to_tags;
DROP POLICY IF EXISTS "Project to tags delete for admins or project members" ON public.project_to_tags;

CREATE POLICY "Project to tags insert for admins or project members"
ON public.project_to_tags
FOR INSERT TO authenticated
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = project_to_tags.project_id
      AND pm.member_id = get_member_id()
  )
);

CREATE POLICY "Project to tags update for admins or project members"
ON public.project_to_tags
FOR UPDATE TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = project_to_tags.project_id
      AND pm.member_id = get_member_id()
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = project_to_tags.project_id
      AND pm.member_id = get_member_id()
  )
);

CREATE POLICY "Project to tags delete for admins or project members"
ON public.project_to_tags
FOR DELETE TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = project_to_tags.project_id
      AND pm.member_id = get_member_id()
  )
);

-- Realization financial modules: merge admin/editor write policy pairs.
DROP POLICY IF EXISTS "Realizace financials insert for admins" ON public.realizace_financials;
DROP POLICY IF EXISTS "Realizace financials insert for editors" ON public.realizace_financials;
DROP POLICY IF EXISTS "Realizace financials update for admins" ON public.realizace_financials;
DROP POLICY IF EXISTS "Realizace financials update for editors" ON public.realizace_financials;
DROP POLICY IF EXISTS "Realizace financials insert for admins or editors" ON public.realizace_financials;
DROP POLICY IF EXISTS "Realizace financials update for admins or editors" ON public.realizace_financials;

CREATE POLICY "Realizace financials insert for admins or editors"
ON public.realizace_financials
FOR INSERT TO authenticated
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = get_user_role()
      AND rp.module = 'realizace'
      AND rp.can_edit = true
  )
);

CREATE POLICY "Realizace financials update for admins or editors"
ON public.realizace_financials
FOR UPDATE TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = get_user_role()
      AND rp.module = 'realizace'
      AND rp.can_edit = true
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = get_user_role()
      AND rp.module = 'realizace'
      AND rp.can_edit = true
  )
);

DROP POLICY IF EXISTS "Realizace overhead insert for admins" ON public.realizace_overhead;
DROP POLICY IF EXISTS "Realizace overhead insert for editors" ON public.realizace_overhead;
DROP POLICY IF EXISTS "Realizace overhead update for admins" ON public.realizace_overhead;
DROP POLICY IF EXISTS "Realizace overhead update for editors" ON public.realizace_overhead;
DROP POLICY IF EXISTS "Realizace overhead insert for admins or editors" ON public.realizace_overhead;
DROP POLICY IF EXISTS "Realizace overhead update for admins or editors" ON public.realizace_overhead;

CREATE POLICY "Realizace overhead insert for admins or editors"
ON public.realizace_overhead
FOR INSERT TO authenticated
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = get_user_role()
      AND rp.module = 'realizace'
      AND rp.can_edit = true
  )
);

CREATE POLICY "Realizace overhead update for admins or editors"
ON public.realizace_overhead
FOR UPDATE TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = get_user_role()
      AND rp.module = 'realizace'
      AND rp.can_edit = true
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = get_user_role()
      AND rp.module = 'realizace'
      AND rp.can_edit = true
  )
);
