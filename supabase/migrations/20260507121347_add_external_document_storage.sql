CREATE TABLE IF NOT EXISTS public.document_storage_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('supabase', 'sharepoint', 'google_drive')),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled', 'error')),
  is_default boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_document_storage_connections_default
  ON public.document_storage_connections (is_default)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_document_storage_connections_provider
  ON public.document_storage_connections (provider);

CREATE TABLE IF NOT EXISTS public.document_storage_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.document_storage_connections(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('project', 'realizace')),
  entity_id uuid NOT NULL,
  folder_path text NOT NULL,
  external_folder_id text,
  external_web_url text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'created', 'error')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_document_storage_folders_entity
  ON public.document_storage_folders (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_document_storage_folders_connection
  ON public.document_storage_folders (connection_id);

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'supabase',
  ADD COLUMN IF NOT EXISTS storage_connection_id uuid REFERENCES public.document_storage_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_file_id text,
  ADD COLUMN IF NOT EXISTS external_parent_id text,
  ADD COLUMN IF NOT EXISTS external_web_url text,
  ADD COLUMN IF NOT EXISTS storage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_documents_storage_connection_id
  ON public.documents (storage_connection_id);

CREATE INDEX IF NOT EXISTS idx_documents_external_file_id
  ON public.documents (external_file_id)
  WHERE external_file_id IS NOT NULL;

ALTER TABLE public.realizace_costs
  ADD COLUMN IF NOT EXISTS invoice_storage_provider text NOT NULL DEFAULT 'supabase',
  ADD COLUMN IF NOT EXISTS invoice_storage_connection_id uuid REFERENCES public.document_storage_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_external_file_id text,
  ADD COLUMN IF NOT EXISTS invoice_external_web_url text,
  ADD COLUMN IF NOT EXISTS invoice_storage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_realizace_costs_invoice_storage_connection_id
  ON public.realizace_costs (invoice_storage_connection_id);

INSERT INTO public.document_storage_connections (provider, name, status, is_default, config)
SELECT 'supabase', 'Supabase Storage', 'active', true, '{"projectBucket":"project-files","invoiceBucket":"invoices"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_storage_connections WHERE is_default = true
);

ALTER TABLE public.document_storage_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_storage_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read storage connections" ON public.document_storage_connections;
CREATE POLICY "Authenticated users can read storage connections"
ON public.document_storage_connections
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Settings admins can manage storage connections" ON public.document_storage_connections;
CREATE POLICY "Settings admins can manage storage connections"
ON public.document_storage_connections
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'settings'
      AND role_permissions.can_admin = true
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'settings'
      AND role_permissions.can_admin = true
  )
);

DROP POLICY IF EXISTS "Document readers can read storage folders" ON public.document_storage_folders;
CREATE POLICY "Document readers can read storage folders"
ON public.document_storage_folders
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module IN ('documents', 'projects', 'realizace')
      AND role_permissions.can_read = true
  )
);

DROP POLICY IF EXISTS "Document editors can manage storage folders" ON public.document_storage_folders;
CREATE POLICY "Document editors can manage storage folders"
ON public.document_storage_folders
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module IN ('documents', 'projects', 'realizace')
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module IN ('documents', 'projects', 'realizace')
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);
