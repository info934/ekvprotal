import { calculateCrmTotals } from './crmItemPayloads.js';

export const getKnownOpportunityMargin = (opportunity) => {
  const items = opportunity?.items;
  if (!items?.length || items.some((item) => {
    const cost = item.unit_cost ?? item.purchase_price_snapshot;
    return cost === null || cost === undefined || cost === '' || !Number.isFinite(Number(cost));
  })) return null;
  const totals = calculateCrmTotals(items);
  return { value: totals.margin_total, percent: totals.margin_percent };
};

export const compareOpportunityUpdated = (a, b) => (
  (Date.parse(b.updated_at || b.created_at) || 0) - (Date.parse(a.updated_at || a.created_at) || 0)
  || String(a.id).localeCompare(String(b.id))
);

export const opportunityMatchesSearch = (opportunity, query) => {
  const needle = query.trim().toLocaleLowerCase('cs-CZ');
  return !needle || [
    opportunity.number, opportunity.title, opportunity.subject?.name,
    opportunity.subject?.ico, opportunity.project?.name,
    opportunity.project?.code, opportunity.next_step,
  ].filter(Boolean).join(' ').toLocaleLowerCase('cs-CZ').includes(needle);
};
