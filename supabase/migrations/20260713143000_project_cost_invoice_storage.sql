ALTER TABLE public.project_costs
  ADD COLUMN IF NOT EXISTS invoice_url text,
  ADD COLUMN IF NOT EXISTS invoice_name text,
  ADD COLUMN IF NOT EXISTS invoice_storage_provider text NOT NULL DEFAULT 'supabase',
  ADD COLUMN IF NOT EXISTS invoice_storage_connection_id uuid REFERENCES public.document_storage_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_external_file_id text,
  ADD COLUMN IF NOT EXISTS invoice_external_web_url text,
  ADD COLUMN IF NOT EXISTS invoice_storage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_project_costs_invoice_storage_connection_id
  ON public.project_costs (invoice_storage_connection_id);

CREATE INDEX IF NOT EXISTS idx_project_costs_invoice_external_file_id
  ON public.project_costs (invoice_external_file_id)
  WHERE invoice_external_file_id IS NOT NULL;

COMMENT ON COLUMN public.project_costs.invoice_url IS
  'Direct URL of the original invoice stored in the project SharePoint folder 04_Fakturace.';

COMMENT ON COLUMN public.project_costs.invoice_storage_metadata IS
  'External storage metadata including the optional shortcut created in the central invoice folder.';
