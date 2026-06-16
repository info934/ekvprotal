export const calculateCrmLineTotal = (item) => {
  const quantity = Number(item?.quantity || 0);
  const price = Number(item?.unit_price || 0);
  const discount = Math.min(100, Math.max(0, Number(item?.discount_percent || 0)));
  return Math.round(quantity * price * (1 - (discount / 100)) * 100) / 100;
};

export const calculateCrmTotals = (items = []) => {
  const subtotal = items.reduce((sum, item) => sum + calculateCrmLineTotal(item), 0);
  const taxTotal = items.reduce((sum, item) => sum + (calculateCrmLineTotal(item) * (Number(item?.vat_rate || 0) / 100)), 0);

  return {
    subtotal,
    discount_total: 0,
    tax_total: Math.round(taxTotal * 100) / 100,
    total: subtotal,
  };
};

const getAvailableQty = (product) => {
  const stock = Array.isArray(product?.stock) ? product.stock[0] : product?.stock;
  return product?.available_qty ?? product?.stock_available_qty ?? stock?.available_qty ?? null;
};

export const createCrmCatalogItem = (product, fallback = {}) => ({
  ...fallback,
  catalog_item_id: product?.id || null,
  code: product?.code || '',
  name: product?.name || 'Položka',
  description: product?.description || '',
  unit: product?.unit || 'ks',
  unit_price: Number(product?.default_unit_price || 0),
  vat_rate: Number(product?.default_vat_rate || 21),
  product_sku: product?.sku || null,
  product_type: product?.product_type || null,
  stock_available_snapshot: getAvailableQty(product),
  catalog_price_snapshot: product?.default_unit_price ?? null,
});

const baseItemPayload = (item, index) => ({
  catalog_item_id: item?.catalog_item_id || null,
  code: item?.code || null,
  name: item?.name?.trim() || 'Položka',
  description: item?.description || null,
  quantity: Number(item?.quantity || 0),
  unit: item?.unit || 'ks',
  unit_price: Number(item?.unit_price || 0),
  discount_percent: Number(item?.discount_percent || 0),
  vat_rate: Number(item?.vat_rate || 0),
  line_total: calculateCrmLineTotal(item),
  sort_order: (index + 1) * 10,
  product_sku: item?.product_sku || null,
  product_type: item?.product_type || null,
  stock_available_snapshot: item?.stock_available_snapshot ?? null,
  catalog_price_snapshot: item?.catalog_price_snapshot ?? null,
});

export const buildCrmOpportunityItemPayload = (item, opportunityId, index) => ({
  opportunity_id: opportunityId,
  ...baseItemPayload(item, index),
});

export const buildCrmDocumentItemPayload = (item, documentId, index) => ({
  document_id: documentId,
  ...baseItemPayload(item, index),
});

export const isMissingCrmRpcError = (error) => {
  if (!error) return false;
  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return ['42883', 'PGRST202'].includes(error.code) ||
    message.includes('replace_crm_opportunity_items') ||
    message.includes('replace_crm_document_items');
};
