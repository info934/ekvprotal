-- Composite indexes for the bounded, ordered lists used by the portal dashboard.
-- Existing single-column indexes remain useful for other filters; these indexes
-- avoid sorting a larger candidate set after the dashboard predicate is applied.

create index if not exists idx_attendance_submissions_status_submitted_at
  on public.attendance_submissions (status, submitted_at);

create index if not exists idx_payouts_status_request_date
  on public.payouts (status, request_date);

create index if not exists idx_crm_opportunities_created_at_desc
  on public.crm_opportunities (created_at desc);

create index if not exists idx_crm_commercial_documents_created_at_desc
  on public.crm_commercial_documents (created_at desc);

create index if not exists idx_documents_created_at_desc
  on public.documents (created_at desc);

create index if not exists idx_project_tasks_member_end_date
  on public.project_tasks (member_id, end_date);

create index if not exists idx_project_tasks_end_date
  on public.project_tasks (end_date);

create index if not exists idx_engineering_activities_status_end_date
  on public.engineering_activities (status, end_date);

create index if not exists idx_realizations_team_members_gin
  on public.realizations using gin (team_members);
