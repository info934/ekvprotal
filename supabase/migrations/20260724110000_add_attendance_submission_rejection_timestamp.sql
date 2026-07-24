-- Attendance workflow functions have recorded rejection timestamps since the
-- hourly workflow rollout. Older production schemas did not receive this
-- additive column, causing rejected attendance flows and reports to fail.
ALTER TABLE public.attendance_submissions
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

COMMENT ON COLUMN public.attendance_submissions.rejected_at IS
  'Timestamp of the latest rejection of a monthly attendance submission.';
