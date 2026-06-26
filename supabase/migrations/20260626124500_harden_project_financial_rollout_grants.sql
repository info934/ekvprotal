-- Harden execute grants for project financial rollout functions.
-- SECURITY DEFINER functions in public must not be callable by anon/PUBLIC.

REVOKE EXECUTE ON FUNCTION public.create_hourly_payout_request(uuid, integer, integer, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_project_member_safe(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_project_subcontractors_safe(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_hourly_payout_request(uuid, integer, integer, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_project_member_safe(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_project_subcontractors_safe(uuid) TO authenticated, service_role;
