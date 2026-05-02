-- Add NOT NULL constraints
ALTER TABLE public.members ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN code SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN status SET NOT NULL;

-- Add CHECK constraints for Percentages (0-100)
ALTER TABLE public.projects 
ADD CONSTRAINT check_project_budget_pct CHECK (budget_percentage >= 0 AND budget_percentage <= 100);

ALTER TABLE public.projects 
ADD CONSTRAINT check_project_overhead_pct CHECK (overhead_percentage >= 0 AND overhead_percentage <= 100);

ALTER TABLE public.realizations
ADD CONSTRAINT check_realization_profit_margin CHECK (profit_margin_percent >= 0 AND profit_margin_percent <= 100);

-- Add CHECK constraints for Positive Amounts
ALTER TABLE public.projects 
ADD CONSTRAINT check_project_price_positive CHECK (price >= 0);

ALTER TABLE public.payouts 
ADD CONSTRAINT check_payout_amount_positive CHECK (amount >= 0);

ALTER TABLE public.payout_items 
ADD CONSTRAINT check_payout_item_amount_positive CHECK (amount > 0);

ALTER TABLE public.realizace_extra_costs 
ADD CONSTRAINT check_extra_cost_positive CHECK (cost_amount >= 0);

-- Add CHECK constraint for Attendance Hours (0-24)
ALTER TABLE public.attendance 
ADD CONSTRAINT check_attendance_hours CHECK (hours > 0 AND hours <= 24);

-- Add UNIQUE constraints
ALTER TABLE public.projects 
ADD CONSTRAINT unique_project_code UNIQUE (code);

-- Fix Foreign Keys (Ensure Cascade or Set Null where appropriate)
-- Drop existing constraints if necessary and re-add with correct rules
-- (Example for payout items)
ALTER TABLE public.payout_items
DROP CONSTRAINT IF EXISTS payout_items_payout_id_fkey,
ADD CONSTRAINT payout_items_payout_id_fkey 
FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE CASCADE;

ALTER TABLE public.payout_items
DROP CONSTRAINT IF EXISTS payout_items_project_id_fkey,
ADD CONSTRAINT payout_items_project_id_fkey 
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;