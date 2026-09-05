import { toFiniteAmount } from './financials.js';

export const splitNetAmount = (totalNet, partCount) => {
  const total = toFiniteAmount(totalNet);
  const count = toFiniteAmount(partCount);
  if (total === null || total <= 0 || !Number.isSafeInteger(count) || count <= 0) return [];
  const cents = Math.round((total + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) return [];
  const regularCents = Math.floor(cents / count);
  const remainder = cents % count;
  return Array.from({ length: count }, (_, index) => (
    (regularCents + (index >= count - remainder ? 1 : 0)) / 100
  ));
};

export const getBillingNetAmounts = (summary = {}) => ({
  contractNet: toFiniteAmount(summary?.contract_amount_excl_vat ?? summary?.contract_amount),
  plannedNet: toFiniteAmount(summary?.planned_amount_excl_vat ?? summary?.planned_amount),
  invoicedNet: toFiniteAmount(summary?.invoiced_amount_excl_vat ?? summary?.invoiced_amount),
  paidNetEquivalent: toFiniteAmount(summary?.paid_amount_excl_vat_equivalent),
  outstandingGross: toFiniteAmount(summary?.outstanding_amount_incl_vat ?? summary?.outstanding_amount),
});
