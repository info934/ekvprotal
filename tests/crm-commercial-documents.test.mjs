import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialDocumentMatchesSearch, getCommercialDocumentTotals } from '../src/lib/crmCommercialDocuments.js';
import { buildCrmItemPayloadFields, calculateCrmTotals } from '../src/lib/crmItemPayloads.js';

test('commercial document lists use persisted financial totals when only item ids are loaded', () => {
  const totals = getCommercialDocumentTotals({
    items: [{ id: 'item-1' }],
    gross_subtotal: '125000',
    discount_total: '5000',
    total: '120000',
    tax_total: '25200',
    total_with_tax: '145200',
    cost_total: '80000',
    margin_total: '40000',
    margin_percent: '33.33',
    commission_total: '3000',
    profit_after_commission: '37000',
    profit_after_commission_percent: '30.83',
  });

  assert.equal(totals.total, 120000);
  assert.equal(totals.margin_total, 40000);
  assert.equal(totals.profit_after_commission, 37000);
  assert.equal(totals.total_with_tax, 145200);
});

test('commercial document details calculate totals from edited line items', () => {
  const totals = getCommercialDocumentTotals({
    total: 1,
    items: [{ quantity: 2, unit_price: 1000, unit_cost: 600, discount_percent: 10, vat_rate: 21, commission_percent: 5 }],
  });

  assert.equal(totals.total, 1800);
  assert.equal(totals.cost_total, 1200);
  assert.equal(totals.margin_total, 600);
  assert.equal(totals.commission_total, 90);
  assert.equal(totals.profit_after_commission, 510);
});

test('commercial document search is accent insensitive and includes company id', () => {
  const document = {
    number: 'NAB-26-018',
    title: 'Nabídka střešní elektrárny',
    subject: { name: 'Příklad s.r.o.', ico: '12345678' },
    opportunity: { number: 'OP-26-041', title: 'Rodinný dům' },
  };

  assert.equal(commercialDocumentMatchesSearch(document, 'strešni'), true);
  assert.equal(commercialDocumentMatchesSearch(document, '12345678'), true);
  assert.equal(commercialDocumentMatchesSearch(document, 'OP-26-041'), true);
  assert.equal(commercialDocumentMatchesSearch(document, 'skladová hala'), false);
});

test('optional and alternative rows excluded from total remain visible but do not affect finance', () => {
  const included = { name: 'Rozvaděč', quantity: 1, unit_price: 10000, unit_cost: 7000, vat_rate: 21 };
  const optional = { name: 'Rozšířená záruka', quantity: 2, unit_price: 2500, unit_cost: 1000, vat_rate: 21, item_kind: 'optional', included_in_total: false };
  const totals = calculateCrmTotals([included, optional]);
  const payload = buildCrmItemPayloadFields(optional, 1);

  assert.equal(totals.total, 10000);
  assert.equal(totals.cost_total, 7000);
  assert.equal(payload.quantity, 2);
  assert.equal(payload.item_kind, 'optional');
  assert.equal(payload.included_in_total, false);
});
