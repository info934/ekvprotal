-- RLS Policy Enhancements for Integrity

-- Ensure users can only insert valid attendance hours via RLS
CREATE POLICY "Validate attendance hours insert" ON public.attendance
AS RESTRICTIVE FOR INSERT WITH CHECK (hours > 0 AND hours <= 24);

CREATE POLICY "Validate attendance hours update" ON public.attendance
AS RESTRICTIVE FOR UPDATE WITH CHECK (hours > 0 AND hours <= 24);

-- Ensure users can only insert positive payout amounts
CREATE POLICY "Validate payout amount" ON public.payouts
AS RESTRICTIVE FOR INSERT WITH CHECK (amount >= 0);

-- Ensure users cannot create projects with invalid percentages
CREATE POLICY "Validate project percentages" ON public.projects
AS RESTRICTIVE FOR INSERT WITH CHECK (
  budget_percentage >= 0 AND budget_percentage <= 100 AND
  overhead_percentage >= 0 AND overhead_percentage <= 100
);