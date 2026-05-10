ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS crm_opportunity_id uuid REFERENCES public.crm_opportunities(id) ON DELETE SET NULL;

ALTER TABLE public.realizations
  ADD COLUMN IF NOT EXISTS crm_opportunity_id uuid REFERENCES public.crm_opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_crm_opportunity_id
  ON public.projects (crm_opportunity_id);

CREATE INDEX IF NOT EXISTS idx_realizations_crm_opportunity_id
  ON public.realizations (crm_opportunity_id);

ALTER TABLE public.crm_opportunities
  ADD COLUMN IF NOT EXISTS realization_id uuid REFERENCES public.realizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_opportunities_realization_id
  ON public.crm_opportunities (realization_id);
