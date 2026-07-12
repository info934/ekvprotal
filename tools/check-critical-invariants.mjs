import assert from 'node:assert/strict';
import { crmCommercialDocumentPath, crmOpportunityPath, findCrmRecordByRef } from '../src/lib/crmRoutes.js';
import { formatCrmNumber, formatCrmYearToken, normalizeCrmNumbering } from '../src/lib/crmNumbering.js';

const opportunity = { id: 'uuid-op', number: 'OP-26-003', title: 'Test opportunity' };
assert.equal(crmOpportunityPath(opportunity), '/crm/OP-26-003');
assert.equal(findCrmRecordByRef([opportunity], 'op-26-003'), opportunity);
assert.equal(findCrmRecordByRef([opportunity], 'uuid-op'), opportunity);

assert.equal(crmCommercialDocumentPath({ type: 'offer', number: 'NAB-26-010' }), '/crm/offers/NAB-26-010');
assert.equal(crmCommercialDocumentPath({ type: 'order', number: 'OBJ-26-010' }), '/crm/orders/OBJ-26-010');

const settings = normalizeCrmNumbering([
  { document_type: 'opportunity', prefix: ' op ', next_number: 7, padding: 4, year_format: 'YYYY' },
]);
assert.equal(formatCrmNumber(settings, 'opportunity', null, new Date('2026-07-12T10:00:00Z')), 'OP-2026-0007');
assert.equal(formatCrmYearToken('YY', new Date('2026-07-12T10:00:00Z')), '26');
assert.equal(formatCrmYearToken('NONE', new Date('2026-07-12T10:00:00Z')), '');

console.log('Critical route and numbering checks passed');
