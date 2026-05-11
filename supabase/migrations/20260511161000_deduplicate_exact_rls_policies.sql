-- Remove exact duplicate RLS policies reported by Supabase advisors.
-- These drops keep an equivalent policy on each table, so behavior is unchanged.

DROP POLICY IF EXISTS "Enable read access for admins" ON public.audit_logs;

DROP POLICY IF EXISTS "Enable all for admins on member_roles" ON public.member_roles;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.members;
DROP POLICY IF EXISTS "Enable all for admins on project_stages" ON public.project_stages;
DROP POLICY IF EXISTS "Enable all for admins on project_tags" ON public.project_tags;
DROP POLICY IF EXISTS "Enable all for admins on project_templates" ON public.project_templates;
DROP POLICY IF EXISTS "Enable read for authenticated users on project_templates" ON public.project_templates;
DROP POLICY IF EXISTS "Enable all for admins on project_types" ON public.project_types;
DROP POLICY IF EXISTS "Enable all for admins on role_permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Enable all for admins on subject_types" ON public.subject_types;
DROP POLICY IF EXISTS "Enable all for admins on subjects" ON public.subjects;
DROP POLICY IF EXISTS "Enable all for admins on task_statuses" ON public.task_statuses;
DROP POLICY IF EXISTS "Enable all for admins on user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Enable read for authenticated users on user_roles" ON public.user_roles;
