import React from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { assessFinancialHealth } from '@/domain/financials';

const money = (value) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency', currency: 'CZK', maximumFractionDigits: 0,
}).format(Number(value || 0));

const config = {
  healthy: { icon: CheckCircle2, title: 'Finanční stav je zdravý', className: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  warning: { icon: AlertTriangle, title: 'Nízká finanční rezerva', className: 'border-amber-200 bg-amber-50 text-amber-950' },
  critical: { icon: ShieldAlert, title: 'Rozpočet je vyčerpaný', className: 'border-orange-300 bg-orange-50 text-orange-950' },
  overallocated: { icon: ShieldAlert, title: 'Odměny jsou přealokované', className: 'border-red-300 bg-red-50 text-red-950' },
  loss: { icon: ShieldAlert, title: 'Projekt je ve ztrátě', className: 'border-red-300 bg-red-50 text-red-950' },
};

const FinancialHealthAlert = ({ baseAmount, remainingAmount, availableAmount, committedAmount = 0, minimumReservePercent = 10, showHealthy = false }) => {
  const health = assessFinancialHealth({ baseAmount, remainingAmount, availableAmount, committedAmount, minimumReservePercent });
  if (health.status === 'healthy' && !showHealthy) return null;
  const state = config[health.status];
  const Icon = state.icon;
  const detail = health.status === 'loss'
    ? `Chybí ${money(Math.abs(health.remaining))}. Další výplaty musí zůstat zablokované a je potřeba upravit cenu, rozsah nebo náklady.`
    : health.status === 'overallocated'
      ? `Nastavené odměny převyšují dostupný základ o ${money(health.overallocation)}. Upravte fixní odměny nebo procentní podíly.`
      : health.status === 'critical'
        ? 'Není dostupný prostor pro další výplatu nebo nový finanční závazek.'
        : `Volná rezerva je ${money(health.available)} (${health.reservePercent.toFixed(1)} % finančního základu).`;

  return (
    <Alert className={state.className}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{state.title}</AlertTitle>
      <AlertDescription>{detail}</AlertDescription>
    </Alert>
  );
};

export default FinancialHealthAlert;
