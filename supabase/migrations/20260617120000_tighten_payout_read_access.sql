DROP POLICY IF EXISTS "Enable read for own payouts, admins or super_managers" ON public.payouts;
DROP POLICY IF EXISTS "Enable insert for own payout requests" ON public.payouts;
DROP POLICY IF EXISTS "Enable read for own payouts or admins" ON public.payout_items;
DROP POLICY IF EXISTS "Enable read for own records or admins" ON public.hourly_payout_requests;
DROP POLICY IF EXISTS "Enable update for own records" ON public.hourly_payout_requests;

CREATE POLICY "Enable read for own payouts or payout admins"
ON public.payouts
FOR SELECT
TO authenticated
USING (
  public.get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = public.get_user_role()
      AND rp.module = 'payouts'
      AND rp.can_admin = true
  )
  OR (
    EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'payouts'
        AND rp.can_read = true
    )
    AND member_id = public.get_member_id()
  )
);

CREATE POLICY "Enable insert for own payouts or payout admins"
ON public.payouts
FOR INSERT
TO authenticated
WITH CHECK (
  public.get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = public.get_user_role()
      AND rp.module = 'payouts'
      AND rp.can_admin = true
  )
  OR member_id = public.get_member_id()
);

CREATE POLICY "Enable read for own payout items or payout admins"
ON public.payout_items
FOR SELECT
TO authenticated
USING (
  public.get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = public.get_user_role()
      AND rp.module = 'payouts'
      AND rp.can_admin = true
  )
  OR payout_id IN (
    SELECT p.id
    FROM public.payouts p
    WHERE p.member_id = public.get_member_id()
  )
);

CREATE POLICY "Enable read for own hourly requests or payout admins"
ON public.hourly_payout_requests
FOR SELECT
TO authenticated
USING (
  public.get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = public.get_user_role()
      AND rp.module = 'payouts'
      AND rp.can_admin = true
  )
  OR member_id = public.get_member_id()
);

CREATE POLICY "Enable update for own hourly requests or payout admins"
ON public.hourly_payout_requests
FOR UPDATE
TO authenticated
USING (
  public.get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = public.get_user_role()
      AND rp.module = 'payouts'
      AND rp.can_admin = true
  )
  OR member_id = public.get_member_id()
)
WITH CHECK (
  public.get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.role = public.get_user_role()
      AND rp.module = 'payouts'
      AND rp.can_admin = true
  )
  OR member_id = public.get_member_id()
);
