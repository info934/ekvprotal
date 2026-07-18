export const formatMoney = (value, options = {}) => {
  const { maximumFractionDigits = 0, currency = 'CZK' } = options;
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency,
    maximumFractionDigits,
  }).format(Number(value || 0));
};

export const formatPercent = (value, maximumFractionDigits = 1) =>
  `${Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits })} %`;

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
