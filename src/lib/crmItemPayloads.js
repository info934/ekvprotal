export const CRM_DEFAULT_VAT_RATE = 21;
export const CRM_DEFAULT_MARGIN_PERCENT = 20;

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const clampPercent = (value) => Math.min(100, Math.max(0, toNumber(value)));

export const roundMoney = (value) => Math.round(toNumber(value) * 100) / 100;

export const getCrmItemUnitCost = (item = {}) => (
  toNumber(
    item.unit_cost ??
    item.purchase_price_snapshot ??
    item.purchase_price ??
    item.unit_purchase_price ??
    item.catalog_purchase_price_snapshot ??
    0
  )
);

export const calculateCrmItem = (item = {}) => {
  const quantity = toNumber(item.quantity);
  const unitPrice = toNumber(item.unit_price ?? item.default_unit_price);
  const unitCost = getCrmItemUnitCost(item);
  const discountPercent = clampPercent(item.discount_percent);
  const vatRate = toNumber(item.vat_rate ?? item.default_vat_rate, CRM_DEFAULT_VAT_RATE);
  const grossSubtotal = roundMoney(quantity * unitPrice);
  const discountAmount = roundMoney(grossSubtotal * (discountPercent / 100));
  const subtotal = roundMoney(grossSubtotal - discountAmount);
  const taxTotal = roundMoney(subtotal * (vatRate / 100));
  const totalWithTax = roundMoney(subtotal + taxTotal);
  const costTotal = roundMoney(quantity * unitCost);
  const marginAmount = roundMoney(subtotal - costTotal);
  const marginPercent = subtotal > 0 ? roundMoney((marginAmount / subtotal) * 100) : 0;

  return {
    quantity,
    unitPrice,
    unitCost,
    discountPercent,
    vatRate,
    grossSubtotal,
    discountAmount,
    subtotal,
    taxTotal,
    total: subtotal,
    totalWithTax,
    costTotal,
    marginAmount,
    marginPercent,
  };
};

export const calculateCrmLineTotal = (item = {}) => calculateCrmItem(item).total;

export const calculateCrmLineSubtotal = (item = {}) => calculateCrmItem(item).grossSubtotal;

export const normalizeCrmItem = (item = {}, index = 0) => {
  const calculation = calculateCrmItem(item);
  return {
    ...item,
    quantity: calculation.quantity,
    unit: item.unit || 'ks',
    unit_price: calculation.unitPrice,
    unit_cost: calculation.unitCost,
    purchase_price_snapshot: calculation.unitCost,
    discount_percent: calculation.discountPercent,
    vat_rate: calculation.vatRate,
    line_total: calculation.total,
    margin_total: calculation.marginAmount,
    margin_percent: calculation.marginPercent,
    sort_order: item.sort_order ?? ((index + 1) * 10),
  };
};

export const calculateCrmTotals = (items = []) => {
  const rows = items.map((item) => calculateCrmItem(item));
  const grossSubtotal = roundMoney(rows.reduce((sum, row) => sum + row.grossSubtotal, 0));
  const subtotal = roundMoney(rows.reduce((sum, row) => sum + row.subtotal, 0));
  const discountTotal = roundMoney(rows.reduce((sum, row) => sum + row.discountAmount, 0));
  const taxTotal = roundMoney(rows.reduce((sum, row) => sum + row.taxTotal, 0));
  const totalWithTax = roundMoney(subtotal + taxTotal);
  const costTotal = roundMoney(rows.reduce((sum, row) => sum + row.costTotal, 0));
  const marginAmount = roundMoney(subtotal - costTotal);
  const marginPercent = subtotal > 0 ? roundMoney((marginAmount / subtotal) * 100) : 0;

  return {
    gross_subtotal: grossSubtotal,
    subtotal: grossSubtotal,
    discount_total: discountTotal,
    tax_total: taxTotal,
    total: subtotal,
    total_with_tax: totalWithTax,
    cost_total: costTotal,
    total_cost: costTotal,
    margin_total: marginAmount,
    margin_value: marginAmount,
    margin_percent: marginPercent,
  };
};

const getCrmCatalogDefaultSalePrice = (product = {}) => {
  const explicitSalePrice = toNumber(product?.default_unit_price ?? product?.unit_price ?? 0);
  if (explicitSalePrice > 0) return explicitSalePrice;

  const purchasePrice = toNumber(product?.purchase_price ?? product?.unit_cost ?? product?.purchase_price_snapshot ?? 0);
  const marginFactor = 1 - (CRM_DEFAULT_MARGIN_PERCENT / 100);
  return purchasePrice > 0 && marginFactor > 0 ? roundMoney(purchasePrice / marginFactor) : 0;
};

const getAvailableQty = (product) => {
  const stock = Array.isArray(product?.stock) ? product.stock[0] : product?.stock;
  return product?.available_qty ?? product?.stock_available_qty ?? stock?.available_qty ?? null;
};

export const createCrmCatalogItem = (product, fallback = {}) => normalizeCrmItem({
  ...fallback,
  catalog_item_id: product?.id || null,
  code: product?.code || product?.sku || '',
  name: product?.name || 'Položka',
  description: product?.description || '',
  quantity: fallback.quantity ?? 1,
  unit: product?.unit || fallback.unit || 'ks',
  unit_price: getCrmCatalogDefaultSalePrice(product),
  unit_cost: Number(product?.purchase_price ?? product?.unit_cost ?? product?.purchase_price_snapshot ?? 0),
  purchase_price_snapshot: Number(product?.purchase_price ?? product?.unit_cost ?? product?.purchase_price_snapshot ?? 0),
  discount_percent: Number(fallback.discount_percent ?? 0),
  vat_rate: Number(product?.default_vat_rate ?? product?.vat_rate ?? CRM_DEFAULT_VAT_RATE),
  product_sku: product?.sku || product?.code || null,
  product_type: product?.product_type || null,
  stock_available_snapshot: getAvailableQty(product),
  catalog_price_snapshot: getCrmCatalogDefaultSalePrice(product),
  supplier_offer_id: product?.preferred_supplier_offer_id || product?.supplier_offer_id || null,
  supplier_name: product?.supplier_name || product?.metadata?.preferred_supplier || null,
  supplier_sku_snapshot: product?.supplier_sku || product?.metadata?.preferred_supplier_sku || null,
});

export const buildCrmItemPayloadFields = (item = {}, index = 0) => {
  const normalized = normalizeCrmItem(item, index);
  return {
    catalog_item_id: normalized.catalog_item_id || null,
    code: normalized.code || null,
    name: normalized.name?.trim() || 'Položka',
    description: normalized.description || null,
    quantity: normalized.quantity,
    unit: normalized.unit || 'ks',
    unit_price: normalized.unit_price,
    unit_cost: normalized.unit_cost,
    purchase_price_snapshot: normalized.purchase_price_snapshot,
    discount_percent: normalized.discount_percent,
    vat_rate: normalized.vat_rate,
    line_total: normalized.line_total,
    margin_total: normalized.margin_total,
    margin_percent: normalized.margin_percent,
    sort_order: (index + 1) * 10,
    product_sku: normalized.product_sku || normalized.sku || null,
    product_type: normalized.product_type || null,
    stock_available_snapshot: normalized.stock_available_snapshot ?? null,
    catalog_price_snapshot: normalized.catalog_price_snapshot ?? normalized.default_unit_price ?? normalized.unit_price ?? null,
    supplier_offer_id: normalized.supplier_offer_id || null,
    supplier_name: normalized.supplier_name || null,
    supplier_sku_snapshot: normalized.supplier_sku_snapshot || null,
  };
};

const baseItemPayload = (item, index) => buildCrmItemPayloadFields(item, index);

export const buildCrmOpportunityItemPayload = (item, opportunityId, index) => ({
  opportunity_id: opportunityId,
  ...baseItemPayload(item, index),
});

export const buildCrmDocumentItemPayload = (item, documentId, index) => ({
  document_id: documentId,
  ...baseItemPayload(item, index),
});

export const calculateCrmItemLineTotal = calculateCrmLineTotal;

export const calculateCrmItemTotals = calculateCrmTotals;

export const createCrmItemFromCatalogProduct = (product = {}, fallback = {}) => createCrmCatalogItem(product, {
  ...fallback,
  id: fallback.id || `new-${Date.now()}-${product.id || product.code || Math.random().toString(36).slice(2)}`,
});

export const isMissingCrmRpcError = (error) => {
  if (!error) return false;
  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return ['42883', 'PGRST202'].includes(error.code) ||
    message.includes('replace_crm_opportunity_items') ||
    message.includes('replace_crm_document_items');
};
