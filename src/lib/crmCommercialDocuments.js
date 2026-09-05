import { calculateCrmTotals } from './crmItemPayloads.js';

const toFiniteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const firstDefinedNumber = (document, keys, fallback = 0) => {
  for (const key of keys) {
    if (document?.[key] !== null && typeof document?.[key] !== 'undefined') {
      return toFiniteNumber(document[key], fallback);
    }
  }
  return fallback;
};

const hasDetailedItems = (items) => (
  Array.isArray(items) && items.some((item) => (
    Object.prototype.hasOwnProperty.call(item || {}, 'unit_price') ||
    Object.prototype.hasOwnProperty.call(item || {}, 'quantity')
  ))
);

export const getCommercialDocumentTotals = (document = {}) => {
  if (hasDetailedItems(document.items)) return calculateCrmTotals(document.items);

  const grossSubtotal = firstDefinedNumber(document, ['gross_subtotal', 'subtotal']);
  const discountTotal = firstDefinedNumber(document, ['discount_total']);
  const total = firstDefinedNumber(document, ['total'], Math.max(grossSubtotal - discountTotal, 0));
  const taxTotal = firstDefinedNumber(document, ['tax_total']);
  const totalWithTax = firstDefinedNumber(document, ['total_with_tax'], total + taxTotal);
  const costTotal = firstDefinedNumber(document, ['cost_total', 'total_cost']);
  const marginTotal = firstDefinedNumber(document, ['margin_total', 'margin_value'], total - costTotal);
  const marginPercent = firstDefinedNumber(document, ['margin_percent'], total > 0 ? (marginTotal / total) * 100 : 0);
  const commissionTotal = firstDefinedNumber(document, ['commission_total']);
  const profitAfterCommission = firstDefinedNumber(document, ['profit_after_commission'], marginTotal - commissionTotal);
  const profitAfterCommissionPercent = firstDefinedNumber(
    document,
    ['profit_after_commission_percent'],
    total > 0 ? (profitAfterCommission / total) * 100 : 0
  );

  return {
    gross_subtotal: grossSubtotal,
    subtotal: grossSubtotal,
    discount_total: discountTotal,
    tax_total: taxTotal,
    total,
    total_with_tax: totalWithTax,
    cost_total: costTotal,
    total_cost: costTotal,
    margin_total: marginTotal,
    margin_value: marginTotal,
    margin_percent: marginPercent,
    commission_total: commissionTotal,
    profit_after_commission: profitAfterCommission,
    profit_after_commission_percent: profitAfterCommissionPercent,
  };
};

const normalizeSearchValue = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

export const commercialDocumentMatchesSearch = (document, query) => {
  const needle = normalizeSearchValue(query).trim();
  if (!needle) return true;

  return [
    document?.number,
    document?.title,
    document?.subject?.name,
    document?.subject?.ico,
    document?.opportunity?.number,
    document?.opportunity?.title,
    document?.opportunity?.subject?.name,
  ].some((value) => normalizeSearchValue(value).includes(needle));
};
