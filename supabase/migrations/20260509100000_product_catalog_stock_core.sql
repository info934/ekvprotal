ALTER TABLE public.commercial_item_catalog
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'service',
  ADD COLUMN IF NOT EXISTS purchase_price numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CZK',
  ADD COLUMN IF NOT EXISTS stock_min_qty numeric(14, 3),
  ADD COLUMN IF NOT EXISTS warehouse_location text,
  ADD COLUMN IF NOT EXISTS allow_backorder boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS datasheet_storage_provider text NOT NULL DEFAULT 'sharepoint',
  ADD COLUMN IF NOT EXISTS datasheet_storage_connection_id uuid REFERENCES public.document_storage_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS datasheet_external_file_id text,
  ADD COLUMN IF NOT EXISTS datasheet_external_web_url text,
  ADD COLUMN IF NOT EXISTS datasheet_file_name text,
  ADD COLUMN IF NOT EXISTS datasheet_preview_image_url text,
  ADD COLUMN IF NOT EXISTS datasheet_storage_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE public.commercial_item_catalog
  DROP CONSTRAINT IF EXISTS commercial_item_catalog_product_type_check;

ALTER TABLE public.commercial_item_catalog
  ADD CONSTRAINT commercial_item_catalog_product_type_check
  CHECK (product_type IN ('service', 'manufactured'));

UPDATE public.commercial_item_catalog
SET sku = code
WHERE sku IS NULL
  AND code IS NOT NULL
  AND code <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_item_catalog_sku_unique
  ON public.commercial_item_catalog (lower(sku))
  WHERE sku IS NOT NULL AND sku <> '';

CREATE INDEX IF NOT EXISTS idx_commercial_item_catalog_product_type
  ON public.commercial_item_catalog (product_type);

CREATE INDEX IF NOT EXISTS idx_commercial_item_catalog_validity
  ON public.commercial_item_catalog (valid_from, valid_until);

CREATE INDEX IF NOT EXISTS idx_commercial_item_catalog_datasheet_connection
  ON public.commercial_item_catalog (datasheet_storage_connection_id);

CREATE INDEX IF NOT EXISTS idx_commercial_item_catalog_datasheet_file
  ON public.commercial_item_catalog (datasheet_external_file_id)
  WHERE datasheet_external_file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_opportunity_items_catalog_item
  ON public.crm_opportunity_items (catalog_item_id);

CREATE INDEX IF NOT EXISTS idx_crm_commercial_document_items_catalog_item
  ON public.crm_commercial_document_items (catalog_item_id);

ALTER TABLE public.document_storage_folders
  DROP CONSTRAINT IF EXISTS document_storage_folders_entity_type_check;

ALTER TABLE public.document_storage_folders
  ADD CONSTRAINT document_storage_folders_entity_type_check
  CHECK (entity_type IN ('project', 'realizace', 'product'));

CREATE TABLE IF NOT EXISTS public.product_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_item_id uuid NOT NULL REFERENCES public.commercial_item_catalog(id) ON DELETE CASCADE,
  movement_type text NOT NULL,
  quantity numeric(14, 3) NOT NULL,
  unit_cost numeric(14, 2),
  source_type text NOT NULL DEFAULT 'manual',
  source_id uuid,
  request_id text,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_stock_movements_type_check
    CHECK (movement_type IN ('receipt', 'issue', 'reservation', 'release', 'adjustment')),
  CONSTRAINT product_stock_movements_quantity_check
    CHECK (quantity <> 0)
);

CREATE INDEX IF NOT EXISTS idx_product_stock_movements_catalog_item
  ON public.product_stock_movements (catalog_item_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_stock_movements_request_unique
  ON public.product_stock_movements (source_type, COALESCE(source_id, '00000000-0000-0000-0000-000000000000'::uuid), request_id)
  WHERE request_id IS NOT NULL;

ALTER TABLE public.product_stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Product stock movements read access" ON public.product_stock_movements;
CREATE POLICY "Product stock movements read access"
ON public.product_stock_movements
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module IN ('crm', 'realizace', 'projects', 'settings')
      AND role_permissions.can_read = true
  )
);

DROP POLICY IF EXISTS "Product stock movements edit access" ON public.product_stock_movements;
CREATE POLICY "Product stock movements edit access"
ON public.product_stock_movements
FOR ALL
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module IN ('realizace', 'settings')
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
)
WITH CHECK (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module IN ('realizace', 'settings')
      AND (role_permissions.can_edit = true OR role_permissions.can_admin = true)
  )
);

CREATE OR REPLACE FUNCTION public.sync_realizace_order_stock_movements(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  order_record public.realizace_orders%ROWTYPE;
  link jsonb;
  item jsonb;
  item_index integer;
  catalog_id uuid;
  item_quantity numeric;
  item_unit_cost numeric;
BEGIN
  SELECT *
  INTO order_record
  FROM public.realizace_orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Realizace order % not found', p_order_id;
  END IF;

  DELETE FROM public.product_stock_movements
  WHERE source_type = 'realizace_order'
    AND source_id = p_order_id;

  IF COALESCE(order_record.commercial_status, 'order') NOT IN ('order', 'offer_accepted') THEN
    RETURN;
  END IF;

  IF order_record.item_links IS NULL OR jsonb_typeof(order_record.item_links) <> 'array' THEN
    RETURN;
  END IF;

  FOR link IN SELECT * FROM jsonb_array_elements(order_record.item_links)
  LOOP
    item_index := NULLIF(link->>'index', '')::integer;
    catalog_id := NULLIF(link->>'catalog_item_id', '')::uuid;
    item := order_record.items -> item_index;

    IF catalog_id IS NULL OR item IS NULL THEN
      CONTINUE;
    END IF;

    item_quantity := ABS(COALESCE(NULLIF(item->>'quantity', '')::numeric, 0));
    item_unit_cost := COALESCE(NULLIF(item->>'unit_price', '')::numeric, 0);

    IF item_quantity <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.product_stock_movements (
      catalog_item_id,
      movement_type,
      quantity,
      unit_cost,
      source_type,
      source_id,
      request_id,
      note
    )
    VALUES (
      catalog_id,
      'issue',
      -item_quantity,
      item_unit_cost,
      'realizace_order',
      p_order_id,
      CONCAT('realizace-order-item-', item_index::text, '-', catalog_id::text),
      CONCAT('Realizace objednavka ', COALESCE(order_record.order_number, p_order_id::text))
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_realizace_order_stock_movements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_realizace_order_stock_movements(uuid) TO authenticated;

DROP VIEW IF EXISTS public.product_stock_status;
CREATE VIEW public.product_stock_status
WITH (security_invoker = true)
AS
SELECT
  catalog.id AS catalog_item_id,
  COALESCE(SUM(
    CASE
      WHEN movement.movement_type IN ('receipt', 'issue', 'adjustment') THEN movement.quantity
      ELSE 0
    END
  ), 0)::numeric(14, 3) AS stock_qty,
  COALESCE(SUM(
    CASE
      WHEN movement.movement_type = 'reservation' THEN movement.quantity
      WHEN movement.movement_type = 'release' THEN -ABS(movement.quantity)
      ELSE 0
    END
  ), 0)::numeric(14, 3) AS reserved_qty,
  (
    COALESCE(SUM(
      CASE
        WHEN movement.movement_type IN ('receipt', 'issue', 'adjustment') THEN movement.quantity
        ELSE 0
      END
    ), 0)
    -
    COALESCE(SUM(
      CASE
        WHEN movement.movement_type = 'reservation' THEN movement.quantity
        WHEN movement.movement_type = 'release' THEN -ABS(movement.quantity)
        ELSE 0
      END
    ), 0)
  )::numeric(14, 3) AS available_qty
FROM public.commercial_item_catalog catalog
LEFT JOIN public.product_stock_movements movement
  ON movement.catalog_item_id = catalog.id
GROUP BY catalog.id;

ALTER TABLE public.crm_opportunity_items
  ADD COLUMN IF NOT EXISTS product_sku text,
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS stock_available_snapshot numeric(14, 3),
  ADD COLUMN IF NOT EXISTS catalog_price_snapshot numeric(14, 2);

ALTER TABLE public.crm_commercial_document_items
  ADD COLUMN IF NOT EXISTS product_sku text,
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS stock_available_snapshot numeric(14, 3),
  ADD COLUMN IF NOT EXISTS catalog_price_snapshot numeric(14, 2);

CREATE TABLE IF NOT EXISTS public.product_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  field_group text NOT NULL DEFAULT 'Technicke parametry',
  unit text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_hint text,
  is_required boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_field_definitions_key_unique UNIQUE (field_key),
  CONSTRAINT product_field_definitions_type_check
    CHECK (field_type IN ('text', 'number', 'boolean', 'date', 'select', 'textarea'))
);

CREATE INDEX IF NOT EXISTS idx_product_field_definitions_active_sort
  ON public.product_field_definitions (is_active, sort_order, label);

INSERT INTO public.product_field_definitions (field_key, label, field_type, field_group, unit, ai_hint, sort_order)
VALUES
  ('manufacturer', 'Vyrobce', 'text', 'Identifikace', NULL, 'Najdi vyrobce nebo brand produktu v datasheetu.', 10),
  ('model', 'Model', 'text', 'Identifikace', NULL, 'Najdi presne modelove oznaceni produktu.', 20),
  ('datasheet_url', 'Datasheet URL', 'text', 'Dokumentace', NULL, 'Odkaz nebo zdrojovy soubor datasheetu.', 30),
  ('power_wp', 'Vykon', 'number', 'Technicke parametry', 'Wp', 'Jmenovity vykon panelu nebo zarizeni.', 40),
  ('warranty_years', 'Zaruka', 'number', 'Obchodni parametry', 'let', 'Delka produktove zaruky v letech.', 50)
ON CONFLICT (field_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.update_product_field_definitions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_product_field_definitions_updated_at ON public.product_field_definitions;
CREATE TRIGGER update_product_field_definitions_updated_at
BEFORE UPDATE ON public.product_field_definitions
FOR EACH ROW EXECUTE FUNCTION public.update_product_field_definitions_updated_at();

ALTER TABLE public.product_field_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Product field definitions read access" ON public.product_field_definitions;
CREATE POLICY "Product field definitions read access"
ON public.product_field_definitions
FOR SELECT
TO authenticated
USING (
  get_user_role() = 'admin'
  OR EXISTS (
    SELECT 1 FROM public.role_permissions
    WHERE role_permissions.role = get_user_role()
      AND role_permissions.module IN ('crm', 'realizace', 'projects', 'settings')
      AND role_permissions.can_read = true
  )
);

DROP POLICY IF EXISTS "Product field definitions admin access" ON public.product_field_definitions;
CREATE POLICY "Product field definitions admin access"
ON public.product_field_definitions
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
