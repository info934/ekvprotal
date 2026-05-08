CREATE TABLE IF NOT EXISTS public.commercial_item_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text,
  name text NOT NULL,
  description text,
  category text,
  unit text NOT NULL DEFAULT 'ks',
  default_unit_price numeric(14, 2) NOT NULL DEFAULT 0,
  default_vat_rate numeric(5, 2) NOT NULL DEFAULT 21,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'offer', 'order', 'import')),
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_item_catalog_active
  ON public.commercial_item_catalog (is_active);

CREATE INDEX IF NOT EXISTS idx_commercial_item_catalog_category
  ON public.commercial_item_catalog (category);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_item_catalog_code_unique
  ON public.commercial_item_catalog (lower(code))
  WHERE code IS NOT NULL AND code <> '';

ALTER TABLE public.realizace_orders
  ADD COLUMN IF NOT EXISTS item_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS offer_reference text,
  ADD COLUMN IF NOT EXISTS commercial_status text NOT NULL DEFAULT 'order'
    CHECK (commercial_status IN ('offer', 'order', 'offer_accepted', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_realizace_orders_commercial_status
  ON public.realizace_orders (commercial_status);

CREATE OR REPLACE FUNCTION public.update_commercial_item_catalog_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_commercial_item_catalog_updated_at ON public.commercial_item_catalog;
CREATE TRIGGER update_commercial_item_catalog_updated_at
BEFORE UPDATE ON public.commercial_item_catalog
FOR EACH ROW EXECUTE FUNCTION public.update_commercial_item_catalog_updated_at();

ALTER TABLE public.commercial_item_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Commercial item catalog read access" ON public.commercial_item_catalog;
CREATE POLICY "Commercial item catalog read access"
ON public.commercial_item_catalog
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module IN ('realizace', 'projects', 'settings')
      AND role_permissions.can_read = true
  )
);

DROP POLICY IF EXISTS "Commercial item catalog edit access" ON public.commercial_item_catalog;
CREATE POLICY "Commercial item catalog edit access"
ON public.commercial_item_catalog
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module IN ('realizace', 'projects', 'settings')
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module IN ('realizace', 'projects', 'settings')
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);
