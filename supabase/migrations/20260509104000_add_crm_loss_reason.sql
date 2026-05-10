ALTER TABLE public.crm_opportunities
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS lost_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_crm_opportunities_lost_at
  ON public.crm_opportunities (lost_at)
  WHERE lost_at IS NOT NULL;
