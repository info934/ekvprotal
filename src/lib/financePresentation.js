import { toFiniteAmount } from '../domain/financials.js';

export const formatMoney = (value, options = {}) => {
  const amount = toFiniteAmount(value);
  if (amount === null) return 'Nedostupné';
  const { maximumFractionDigits = 0, minimumFractionDigits = 0, currency = 'CZK' } = options;
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    maximumFractionDigits,
    minimumFractionDigits,
  }).format(amount);
};

export const formatPercent = (value, maximumFractionDigits = 1) => {
  const amount = toFiniteAmount(value);
  return amount === null ? 'Nedostupné' : `${amount.toLocaleString('cs-CZ', { maximumFractionDigits })} %`;
};

export async function fetchAllFinancialRows(factory, signal, pageSize = 250) {
  const rows = [];
  while (true) {
    if (signal?.aborted) throw new DOMException('Načítání bylo přerušeno.', 'AbortError');
    let query = factory().range(rows.length, rows.length + pageSize - 1);
    if (signal) query = query.abortSignal(signal);
    const result = await query;
    if (result.error) throw result.error;
    if (!Array.isArray(result.data)) throw new Error('Server nevrátil úplná finanční data.');
    if (!result.data.length) return rows;
    rows.push(...result.data);
  }
}

export function aggregateFinancialPeriods(rows) {
  const months = new Map();
  for (const row of rows) {
    if (typeof row.period !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.period)) throw new Error('Finanční záznam nemá platné období.');
    const date = new Date(`${row.period}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.period) throw new Error('Finanční záznam nemá platné období.');
    const month = row.period.slice(0, 7);
    const item = months.get(month) || { month, revenue: 0, costs: 0, profit: 0 };
    for (const [source, target] of [['actual_revenue', 'revenue'], ['actual_costs', 'costs'], ['actual_profit', 'profit']]) {
      const amount = toFiniteAmount(row[source]);
      if (amount === null) throw new Error('Finanční záznam obsahuje neúplnou nebo neplatnou částku.');
      item[target] += amount;
      if (!Number.isFinite(item[target])) throw new Error('Finanční souhrn překročil podporovaný rozsah.');
    }
    months.set(month, item);
  }
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export const financeMetricTones = {
  neutral: 'border-slate-200 bg-white text-slate-950',
  plan: 'border-blue-200 bg-blue-50/60 text-blue-950',
  warning: 'border-amber-200 bg-amber-50/70 text-amber-950',
  positive: 'border-emerald-200 bg-emerald-50/70 text-emerald-950',
  negative: 'border-red-200 bg-red-50/70 text-red-950',
};

export const VAT_RATE_OPTIONS = [
  { value: '21', label: '21 % · základní sazba' },
  { value: '12', label: '12 % · snížená sazba' },
  { value: '0', label: '0 % · bez DPH' },
];

export const getFinanceErrorMessage = (error, fallback = 'Operaci se nepodařilo dokončit. Zkuste ji znovu.') => {
  const message = String(error?.message || error || '').toLowerCase();
  if (!message) return fallback;
  if (message.includes('permission') || message.includes('row-level security') || message.includes('not authorized')) {
    return 'Pro tuto finanční operaci nemáte potřebné oprávnění.';
  }
  if (message.includes('schema cache') || message.includes('column') && message.includes('does not exist')) {
    return 'Databázová struktura není aktuální. Kontaktujte správce a operaci zatím neopakujte.';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'Nepodařilo se spojit se serverem. Zkontrolujte připojení a zkuste to znovu.';
  }
  if (message.includes('required') || message.includes('not-null')) {
    return 'Chybí povinný finanční údaj. Zkontrolujte formulář a zkuste to znovu.';
  }
  return fallback;
};
