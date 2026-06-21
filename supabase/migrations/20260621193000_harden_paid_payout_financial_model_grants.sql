-- Harden execute grants for paid payout financial model functions.
-- SECURITY DEFINER functions in public must not be callable by anon/PUBLIC.

REVOKE EXECUTE ON FUNCTION public.project_financial_summary(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.realization_financial_summary(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_member_project_rewards(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_projects_with_balance(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_payout_availability(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_realization_financial_overview() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_hourly_payout_request(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_hourly_payout_request(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_hourly_payout_paid(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.project_financial_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.realization_financial_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_member_project_rewards(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_projects_with_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payout_availability(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_realization_financial_overview() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_hourly_payout_request(uuid, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_hourly_payout_request(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_hourly_payout_paid(uuid) TO authenticated, service_role;
