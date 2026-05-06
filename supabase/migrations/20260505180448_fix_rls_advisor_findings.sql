-- Fix findings reported by Supabase Database Advisors.
-- This keeps the current authenticated app behavior, but removes anonymous public access.

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realizace_extra_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realization_profit_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage project members" ON public.project_members;
CREATE POLICY "Authenticated users can manage project members"
ON public.project_members
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can manage realizace extra costs" ON public.realizace_extra_costs;
CREATE POLICY "Authenticated users can manage realizace extra costs"
ON public.realizace_extra_costs
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can manage realization profit shares" ON public.realization_profit_shares;
CREATE POLICY "Authenticated users can manage realization profit shares"
ON public.realization_profit_shares
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can manage reports" ON public.reports;
CREATE POLICY "Admins can manage reports"
ON public.reports
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'reports'
      AND role_permissions.can_admin = true
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1
    FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'reports'
      AND role_permissions.can_admin = true
  )
);

ALTER FUNCTION public.update_overhead_costs_updated_at() SET search_path = public;
ALTER FUNCTION public.update_monthly_allocations_updated_at() SET search_path = public;
ALTER FUNCTION public.update_hourly_payout_requests_updated_at() SET search_path = public;
ALTER FUNCTION public.refresh_user_rewards() SET search_path = public;
ALTER FUNCTION public.trigger_refresh_user_rewards() SET search_path = public;
ALTER FUNCTION public.update_project_templates_custom_updated_at() SET search_path = public;
ALTER FUNCTION public.update_payout_total_amount() SET search_path = public;
ALTER FUNCTION public.get_realizations_with_balance(uuid) SET search_path = public;
ALTER FUNCTION public.sync_realizace_team_members_to_array() SET search_path = public;
ALTER FUNCTION public.notify_admin_payout_change() SET search_path = public;
ALTER FUNCTION public.notify_member_hourly_payout_change() SET search_path = public;
ALTER FUNCTION public.get_projects_with_balance(uuid) SET search_path = public;
ALTER FUNCTION public.update_realizations_updated_at() SET search_path = public;
ALTER FUNCTION public.get_realizace_financials() SET search_path = public;
ALTER FUNCTION public.get_realizace_overhead_summary() SET search_path = public;
ALTER FUNCTION public.update_realizace_orders_updated_at() SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.get_member_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_permissions(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_activities(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_financials(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_projects(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_user_rewards() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_payout_total_amount() FROM anon;

REVOKE EXECUTE ON FUNCTION public.get_member_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_permissions(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_activities(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_financials(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_projects(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_user_rewards() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_payout_total_amount() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_member_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_permissions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_activities(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_financials(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_projects(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_user_rewards() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_payout_total_amount() TO authenticated;

REVOKE SELECT ON public.mv_user_project_rewards FROM anon;
REVOKE SELECT ON public.mv_user_project_rewards FROM authenticated;
REVOKE SELECT ON public.mv_user_project_rewards FROM PUBLIC;
