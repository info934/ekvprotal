-- Custom project templates are private to their owner; administrators may
-- inspect them for support. The active-account policy is restrictive and does
-- not grant SELECT by itself, so an explicit permissive read policy is needed.
begin;

drop policy if exists "Project custom templates select for admins or owners"
  on public.project_templates_custom;

create policy "Project custom templates select for admins or owners"
on public.project_templates_custom
for select
to authenticated
using (
  (select public.get_user_role()) = 'admin'
  or user_id = (select auth.uid())
);

notify pgrst, 'reload schema';

commit;
