CREATE TABLE IF NOT EXISTS public.crm_commercial_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'offer' CHECK (type IN ('offer', 'order')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'cancelled', 'closed')),
  number text,
  title text NOT NULL,
  issue_date date NOT NULL DEFAULT current_date,
  valid_until date,
  currency text NOT NULL DEFAULT 'CZK',
  subtotal numeric(14, 2) NOT NULL DEFAULT 0,
  discount_total numeric(14, 2) NOT NULL DEFAULT 0,
  tax_total numeric(14, 2) NOT NULL DEFAULT 0,
  total numeric(14, 2) NOT NULL DEFAULT 0,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_commercial_document_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.crm_commercial_documents(id) ON DELETE CASCADE,
  catalog_item_id uuid REFERENCES public.commercial_item_catalog(id) ON DELETE SET NULL,
  code text,
  name text NOT NULL,
  description text,
  quantity numeric(14, 3) NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT 'ks',
  unit_price numeric(14, 2) NOT NULL DEFAULT 0,
  discount_percent numeric(6, 2) NOT NULL DEFAULT 0,
  vat_rate numeric(5, 2) NOT NULL DEFAULT 21,
  line_total numeric(14, 2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_commercial_documents_opportunity_id
  ON public.crm_commercial_documents (opportunity_id);

CREATE INDEX IF NOT EXISTS idx_crm_commercial_documents_subject_id
  ON public.crm_commercial_documents (subject_id);

CREATE INDEX IF NOT EXISTS idx_crm_commercial_documents_type_status
  ON public.crm_commercial_documents (type, status);

CREATE INDEX IF NOT EXISTS idx_crm_commercial_document_items_document_id
  ON public.crm_commercial_document_items (document_id);

DROP TRIGGER IF EXISTS update_crm_commercial_documents_updated_at ON public.crm_commercial_documents;
CREATE TRIGGER update_crm_commercial_documents_updated_at
BEFORE UPDATE ON public.crm_commercial_documents
FOR EACH ROW EXECUTE FUNCTION public.update_crm_updated_at();

DROP TRIGGER IF EXISTS update_crm_commercial_document_items_updated_at ON public.crm_commercial_document_items;
CREATE TRIGGER update_crm_commercial_document_items_updated_at
BEFORE UPDATE ON public.crm_commercial_document_items
FOR EACH ROW EXECUTE FUNCTION public.update_crm_updated_at();

ALTER TABLE public.crm_commercial_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_commercial_document_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CRM commercial documents read access" ON public.crm_commercial_documents;
CREATE POLICY "CRM commercial documents read access"
ON public.crm_commercial_documents
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_read = true
  )
);

DROP POLICY IF EXISTS "CRM commercial documents edit access" ON public.crm_commercial_documents;
CREATE POLICY "CRM commercial documents edit access"
ON public.crm_commercial_documents
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);

DROP POLICY IF EXISTS "CRM commercial document items read access" ON public.crm_commercial_document_items;
CREATE POLICY "CRM commercial document items read access"
ON public.crm_commercial_document_items
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND role_permissions.can_read = true
  )
);

DROP POLICY IF EXISTS "CRM commercial document items edit access" ON public.crm_commercial_document_items;
CREATE POLICY "CRM commercial document items edit access"
ON public.crm_commercial_document_items
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module = 'crm'
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);
