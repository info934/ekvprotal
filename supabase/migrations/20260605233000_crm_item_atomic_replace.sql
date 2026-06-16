CREATE OR REPLACE FUNCTION public.can_edit_crm()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'crm'
        AND (rp.can_edit = true OR rp.can_admin = true)
    );
$$;

CREATE OR REPLACE FUNCTION public.replace_crm_opportunity_items(
  p_opportunity_id uuid,
  p_items jsonb,
  p_sync_documents boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric(14, 2) := 0;
  v_tax_total numeric(14, 2) := 0;
  v_document_ids uuid[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.can_edit_crm() THEN
    RAISE EXCEPTION 'CRM edit permission required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.crm_opportunities WHERE id = p_opportunity_id) THEN
    RAISE EXCEPTION 'CRM opportunity % not found', p_opportunity_id;
  END IF;

  DROP TABLE IF EXISTS pg_temp.crm_rpc_items;
  CREATE TEMP TABLE crm_rpc_items ON COMMIT DROP AS
  SELECT
    row_number() OVER () AS row_number,
    NULLIF(item.catalog_item_id, '00000000-0000-0000-0000-000000000000'::uuid) AS catalog_item_id,
    NULLIF(BTRIM(item.code), '') AS code,
    COALESCE(NULLIF(BTRIM(item.name), ''), 'Položka') AS name,
    NULLIF(BTRIM(item.description), '') AS description,
    COALESCE(item.quantity, 0)::numeric AS quantity,
    COALESCE(NULLIF(BTRIM(item.unit), ''), 'ks') AS unit,
    COALESCE(item.unit_price, 0)::numeric AS unit_price,
    LEAST(100, GREATEST(0, COALESCE(item.discount_percent, 0)))::numeric AS discount_percent,
    COALESCE(item.vat_rate, 0)::numeric AS vat_rate,
    NULLIF(BTRIM(item.product_sku), '') AS product_sku,
    NULLIF(BTRIM(item.product_type), '') AS product_type,
    item.stock_available_snapshot::numeric AS stock_available_snapshot,
    item.catalog_price_snapshot::numeric AS catalog_price_snapshot,
    COALESCE(item.sort_order, row_number() OVER () * 10)::integer AS sort_order
  FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb)) AS item(
    catalog_item_id uuid,
    code text,
    name text,
    description text,
    quantity numeric,
    unit text,
    unit_price numeric,
    discount_percent numeric,
    vat_rate numeric,
    product_sku text,
    product_type text,
    stock_available_snapshot numeric,
    catalog_price_snapshot numeric,
    sort_order integer
  );

  DELETE FROM public.crm_opportunity_items
  WHERE opportunity_id = p_opportunity_id;

  INSERT INTO public.crm_opportunity_items (
    opportunity_id,
    catalog_item_id,
    code,
    name,
    description,
    quantity,
    unit,
    unit_price,
    discount_percent,
    vat_rate,
    line_total,
    sort_order,
    product_sku,
    product_type,
    stock_available_snapshot,
    catalog_price_snapshot
  )
  SELECT
    p_opportunity_id,
    catalog_item_id,
    code,
    name,
    description,
    quantity,
    unit,
    unit_price,
    discount_percent,
    vat_rate,
    ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2),
    sort_order,
    product_sku,
    product_type,
    stock_available_snapshot,
    catalog_price_snapshot
  FROM crm_rpc_items
  ORDER BY sort_order, row_number;

  SELECT
    COALESCE(SUM(ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2)), 0),
    COALESCE(SUM(ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2) * (vat_rate / 100)), 0)
  INTO v_total, v_tax_total
  FROM crm_rpc_items;

  v_tax_total := ROUND(v_tax_total, 2);

  UPDATE public.crm_opportunities
  SET value = v_total,
      updated_at = now()
  WHERE id = p_opportunity_id;

  IF p_sync_documents THEN
    SELECT COALESCE(array_agg(id), '{}')
    INTO v_document_ids
    FROM public.crm_commercial_documents
    WHERE opportunity_id = p_opportunity_id
      AND COALESCE(sync_items, true) = true;

    DELETE FROM public.crm_commercial_document_items
    WHERE document_id = ANY(v_document_ids);

    INSERT INTO public.crm_commercial_document_items (
      document_id,
      catalog_item_id,
      code,
      name,
      description,
      quantity,
      unit,
      unit_price,
      discount_percent,
      vat_rate,
      line_total,
      sort_order,
      product_sku,
      product_type,
      stock_available_snapshot,
      catalog_price_snapshot
    )
    SELECT
      document_id,
      item.catalog_item_id,
      item.code,
      item.name,
      item.description,
      item.quantity,
      item.unit,
      item.unit_price,
      item.discount_percent,
      item.vat_rate,
      ROUND(item.quantity * item.unit_price * (1 - (item.discount_percent / 100)), 2),
      item.sort_order,
      item.product_sku,
      item.product_type,
      item.stock_available_snapshot,
      item.catalog_price_snapshot
    FROM unnest(v_document_ids) AS document_id
    CROSS JOIN crm_rpc_items item
    ORDER BY document_id, item.sort_order, item.row_number;

    UPDATE public.crm_commercial_documents
    SET subtotal = v_total,
        discount_total = 0,
        tax_total = v_tax_total,
        total = v_total,
        updated_at = now()
    WHERE id = ANY(v_document_ids);
  END IF;

  RETURN jsonb_build_object(
    'opportunity_id', p_opportunity_id,
    'item_count', (SELECT COUNT(*) FROM crm_rpc_items),
    'document_count', COALESCE(array_length(v_document_ids, 1), 0),
    'subtotal', v_total,
    'tax_total', v_tax_total,
    'total', v_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_crm_document_items(
  p_document_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total numeric(14, 2) := 0;
  v_tax_total numeric(14, 2) := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.can_edit_crm() THEN
    RAISE EXCEPTION 'CRM edit permission required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.crm_commercial_documents WHERE id = p_document_id) THEN
    RAISE EXCEPTION 'CRM commercial document % not found', p_document_id;
  END IF;

  DROP TABLE IF EXISTS pg_temp.crm_rpc_items;
  CREATE TEMP TABLE crm_rpc_items ON COMMIT DROP AS
  SELECT
    row_number() OVER () AS row_number,
    NULLIF(item.catalog_item_id, '00000000-0000-0000-0000-000000000000'::uuid) AS catalog_item_id,
    NULLIF(BTRIM(item.code), '') AS code,
    COALESCE(NULLIF(BTRIM(item.name), ''), 'Položka') AS name,
    NULLIF(BTRIM(item.description), '') AS description,
    COALESCE(item.quantity, 0)::numeric AS quantity,
    COALESCE(NULLIF(BTRIM(item.unit), ''), 'ks') AS unit,
    COALESCE(item.unit_price, 0)::numeric AS unit_price,
    LEAST(100, GREATEST(0, COALESCE(item.discount_percent, 0)))::numeric AS discount_percent,
    COALESCE(item.vat_rate, 0)::numeric AS vat_rate,
    NULLIF(BTRIM(item.product_sku), '') AS product_sku,
    NULLIF(BTRIM(item.product_type), '') AS product_type,
    item.stock_available_snapshot::numeric AS stock_available_snapshot,
    item.catalog_price_snapshot::numeric AS catalog_price_snapshot,
    COALESCE(item.sort_order, row_number() OVER () * 10)::integer AS sort_order
  FROM jsonb_to_recordset(COALESCE(p_items, '[]'::jsonb)) AS item(
    catalog_item_id uuid,
    code text,
    name text,
    description text,
    quantity numeric,
    unit text,
    unit_price numeric,
    discount_percent numeric,
    vat_rate numeric,
    product_sku text,
    product_type text,
    stock_available_snapshot numeric,
    catalog_price_snapshot numeric,
    sort_order integer
  );

  DELETE FROM public.crm_commercial_document_items
  WHERE document_id = p_document_id;

  INSERT INTO public.crm_commercial_document_items (
    document_id,
    catalog_item_id,
    code,
    name,
    description,
    quantity,
    unit,
    unit_price,
    discount_percent,
    vat_rate,
    line_total,
    sort_order,
    product_sku,
    product_type,
    stock_available_snapshot,
    catalog_price_snapshot
  )
  SELECT
    p_document_id,
    catalog_item_id,
    code,
    name,
    description,
    quantity,
    unit,
    unit_price,
    discount_percent,
    vat_rate,
    ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2),
    sort_order,
    product_sku,
    product_type,
    stock_available_snapshot,
    catalog_price_snapshot
  FROM crm_rpc_items
  ORDER BY sort_order, row_number;

  SELECT
    COALESCE(SUM(ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2)), 0),
    COALESCE(SUM(ROUND(quantity * unit_price * (1 - (discount_percent / 100)), 2) * (vat_rate / 100)), 0)
  INTO v_total, v_tax_total
  FROM crm_rpc_items;

  v_tax_total := ROUND(v_tax_total, 2);

  UPDATE public.crm_commercial_documents
  SET subtotal = v_total,
      discount_total = 0,
      tax_total = v_tax_total,
      total = v_total,
      updated_at = now()
  WHERE id = p_document_id;

  RETURN jsonb_build_object(
    'document_id', p_document_id,
    'item_count', (SELECT COUNT(*) FROM crm_rpc_items),
    'subtotal', v_total,
    'tax_total', v_tax_total,
    'total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.can_edit_crm() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_crm_opportunity_items(uuid, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_crm_document_items(uuid, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_edit_crm() TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_crm_opportunity_items(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_crm_document_items(uuid, jsonb) TO authenticated;

