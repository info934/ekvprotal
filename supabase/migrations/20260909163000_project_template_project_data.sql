alter table public.project_templates_custom
  add column if not exists project_data jsonb not null default '{}'::jsonb;

alter table public.project_templates_custom
  drop constraint if exists project_templates_custom_project_data_object_check;

alter table public.project_templates_custom
  add constraint project_templates_custom_project_data_object_check
  check (jsonb_typeof(project_data) = 'object');

comment on column public.project_templates_custom.project_data is
  'Versioned snapshot of reusable project defaults. Unique project identity, price and dates are intentionally excluded by the application.';
