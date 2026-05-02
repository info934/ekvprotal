import {
  areRealizationPercentagesValid,
  calculateRealizationFinancials,
  toAmount,
} from '@/domain/financials';

export const calculateProfit = (amount, percent) => toAmount(amount) * (toAmount(percent) / 100);
export const calculateOverhead = (amount, percent) => toAmount(amount) * (toAmount(percent) / 100);

/**
 * Calculates Team Budget based on the formula:
 * Team Budget = Contract Amount - Profit - Overhead - Total Costs
 */
export const calculateTeamBudget = (contractAmount, profitMarginPercent, overheadPercent, totalCosts) => {
  return calculateRealizationFinancials({
    contract_amount: contractAmount,
    profit_margin_percent: profitMarginPercent,
    overhead_percent: overheadPercent,
  }, totalCosts).teamBudget;
};

/**
 * Calculates financial breakdown for a realization
 * @param {number} contractAmount - Total contract value
 * @param {number} profitMarginPercent - Percentage reserved for company profit
 * @param {number} overheadPercent - Percentage reserved for company overhead
 * @param {number} totalCosts - Sum of all costs (manual + hourly + extra)
 * @returns {object} Calculated amounts
 */
export const calculateFinancials = (contractAmount, profitMarginPercent, overheadPercent, totalCosts = 0) => {
  return calculateRealizationFinancials({
    contract_amount: contractAmount,
    profit_margin_percent: profitMarginPercent,
    overhead_percent: overheadPercent,
  }, totalCosts);
};

/**
 * Validates that percentages do not exceed 100%
 * @param {number} marginPct
 * @param {number} overheadPct
 * @returns {boolean} True if valid
 */
export const validatePercentages = (marginPct, overheadPct) => {
  return areRealizationPercentagesValid(marginPct, overheadPct);
};
