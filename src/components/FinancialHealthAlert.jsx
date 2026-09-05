import React from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { assessFinancialHealth } from '@/domain/financials';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatMoney } from '@/lib/financePresentation';

const money = formatMoney;

const config = {
  healthy: { icon: CheckCircle2, title: 'Rozpočet má dostatečnou rezervu', className: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  warning: { icon: AlertTriangle, title: 'Nízká rozpočtová rezerva', className: 'border-amber-200 bg-amber-50 text-amber-950' },
  critical: { icon: ShieldAlert, title: 'Rozpočtová rezerva je vyčerpaná', className: 'border-orange-300 bg-orange-50 text-orange-950' },
  overallocated: { icon: ShieldAlert, title: 'Odměny jsou přealokované', className: 'border-red-300 bg-red-50 text-red-950' },
  loss: { icon: ShieldAlert, title: 'Rozpočet pro odměny je překročený', className: 'border-red-300 bg-red-50 text-red-950' },
  unavailable: { icon: AlertTriangle, title: 'Rozpočtovou rezervu nelze vyhodnotit', className: 'border-slate-200 bg-slate-50 text-slate-700' },
};

const FinancialHealthAlert = ({ baseAmount, remainingAmount, availableAmount, committedAmount = 0, minimumReservePercent = 10, showHealthy = false }) => {
  const { isPrivateMode, userRole } = useAuth();
  const health = assessFinancialHealth({ baseAmount, remainingAmount, availableAmount, committedAmount, minimumReservePercent });
  if (isPrivateMode || userRole !== 'admin') return null;
  if (health.status === 'healthy' && !showHealthy) return null;
  const state = config[health.status];
  const Icon = state.icon;
  const detail = health.status === 'loss'
    ? `Náklady převyšují základ pro odměny o ${money(Math.abs(health.remaining))}. Zkontrolujte cenu, náklady a rozpočtové rezervy firmy.`
    : health.status === 'overallocated'
      ? `Nastavené odměny převyšují dostupný základ o ${money(health.overallocation)}. Upravte fixní odměny nebo procentní podíly.`
      : health.status === 'critical'
        ? 'V tomto rozpočtu nezbývá volná rezerva. Již přidělené nároky a schválení výplat posuzuje samostatně přehled výplat.'
        : health.status === 'unavailable'
          ? 'Chybí úplné finanční údaje. Obnovte přehled před rozhodnutím o nových odměnách.'
          : `Volná rozpočtová rezerva je ${money(health.available)} (${health.reservePercent.toFixed(1)} % finančního základu). Nejde o stav peněz na účtu.`;

  return (
    <Alert className={state.className}>
      <Icon className="h-4 w-4" />
      <AlertTitle>{state.title}</AlertTitle>
      <AlertDescription>{detail}</AlertDescription>
    </Alert>
  );
};

export default FinancialHealthAlert;
