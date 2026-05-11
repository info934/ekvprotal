-- Reduce overlapping permissive RLS policies on core workflow tables.
-- The changes keep the existing intent but remove policies covered by broader
-- equivalent rules, and split broad ALL policies so SELECT remains explicit.

-- Hourly payout requests: admin insert/read/update is already covered by the
-- combined own-or-admin policies. Merge duplicate own-delete rules.
DROP POLICY IF EXISTS "Enable insert for admins" ON public.hourly_payout_requests;
DROP POLICY IF EXISTS "Enable read for admins" ON public.hourly_payout_requests;
DROP POLICY IF EXISTS "Enable update for admins" ON public.hourly_payout_requests;
DROP POLICY IF EXISTS "Enable delete for own pending requests only" ON public.hourly_payout_requests;
DROP POLICY IF EXISTS "Enable delete for own rejected requests only" ON public.hourly_payout_requests;
DROP POLICY IF EXISTS "Enable delete for own pending or rejected requests" ON public.hourly_payout_requests;

CREATE POLICY "Enable delete for own pending or rejected requests"
ON public.hourly_payout_requests
FOR DELETE TO authenticated
USING (
  member_id = get_member_id()
  AND status IN ('pending', 'rejected')
);

-- Payouts: invoice upload for own payouts and admin workflow management already
-- cover the older user-only update policy.
DROP POLICY IF EXISTS "Enable update for own payout records" ON public.payouts;

-- Project contacts: replace ALL policy with write-only policies so the SELECT
-- policy is the only read policy.
DROP POLICY IF EXISTS "Enable edit for project members" ON public.project_contacts;
DROP POLICY IF EXISTS "Project contacts insert for project members" ON public.project_contacts;
DROP POLICY IF EXISTS "Project contacts update for project members" ON public.project_contacts;
DROP POLICY IF EXISTS "Project contacts delete for project members" ON public.project_contacts;

CREATE POLICY "Project contacts insert for project members"
ON public.project_contacts
FOR INSERT TO authenticated
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = project_contacts.project_id
      AND pm.member_id = get_member_id()
  )
);

CREATE POLICY "Project contacts update for project members"
ON public.project_contacts
FOR UPDATE TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = project_contacts.project_id
      AND pm.member_id = get_member_id()
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = project_contacts.project_id
      AND pm.member_id = get_member_id()
  )
);

CREATE POLICY "Project contacts delete for project members"
ON public.project_contacts
FOR DELETE TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = project_contacts.project_id
      AND pm.member_id = get_member_id()
  )
);

-- Project tasks: keep the member/admin SELECT policy and remove global read.
DROP POLICY IF EXISTS "Enable read access for all users" ON public.project_tasks;

-- Projects: split the broad ALL admin policy into write-only policies so the
-- assigned-member SELECT policy is the only read path.
DROP POLICY IF EXISTS "Enable manage for admins or authorized members" ON public.projects;
DROP POLICY IF EXISTS "Projects insert for admins" ON public.projects;
DROP POLICY IF EXISTS "Projects update for admins" ON public.projects;
DROP POLICY IF EXISTS "Projects delete for admins" ON public.projects;

CREATE POLICY "Projects insert for admins"
ON public.projects
FOR INSERT TO authenticated
WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "Projects update for admins"
ON public.projects
FOR UPDATE TO authenticated
USING (get_user_role() = 'admin')
WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "Projects delete for admins"
ON public.projects
FOR DELETE TO authenticated
USING (get_user_role() = 'admin');
