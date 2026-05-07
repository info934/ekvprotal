-- Prepare role permissions for the CRM module.
-- CRM currently reuses existing subjects, project contacts, projects, tasks and realizace data.

INSERT INTO public.role_permissions (role, module, can_read, can_edit, can_admin)
SELECT
  role_name,
  'crm',
  role_name IN ('admin', 'super_manager', 'manager'),
  role_name IN ('admin', 'super_manager', 'manager'),
  role_name = 'admin'
FROM public.user_roles
ON CONFLICT (role, module) DO NOTHING;
