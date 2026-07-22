const moneyRound = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const splitNetAmount = (totalNet, partCount) => {
  const total = Math.max(0, Number(totalNet) || 0);
  const count = Math.max(0, Math.trunc(Number(partCount) || 0));
  if (!total || !count) return [];

  const regularPart = moneyRound(total / count);
  return Array.from({ length: count }, (_, index) => (
    index === count - 1
      ? moneyRound(total - regularPart * (count - 1))
      : regularPart
  ));
};

export const getBillingNetAmounts = (summary = {}) => ({
  contractNet: Number(summary.contract_amount_excl_vat ?? summary.contract_amount ?? 0),
  plannedNet: Number(summary.planned_amount_excl_vat ?? summary.planned_amount ?? 0),
  invoicedNet: Number(summary.invoiced_amount_excl_vat ?? summary.invoiced_amount ?? 0),
  paidNetEquivalent: Number(summary.paid_amount_excl_vat_equivalent ?? 0),
  outstandingGross: Number(summary.outstanding_amount_incl_vat ?? summary.outstanding_amount ?? 0),
});
