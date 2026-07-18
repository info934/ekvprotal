import React from 'react';
import { AlertTriangle, EyeOff, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { financeMetricTones, formatMoney } from '@/lib/financePresentation';

export const FinanceAmount = ({ value, currency = 'CZK', exact = false, className }) => (
  <span
    className={cn('whitespace-nowrap tabular-nums', className)}
    title={formatMoney(value, { maximumFractionDigits: 2, currency })}
  >
    {formatMoney(value, { maximumFractionDigits: exact ? 2 : 0, currency })}
  </span>
);

export const FinanceMetricStrip = ({ metrics = [], className }) => (
  <div className={cn('grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6', className)}>
    {metrics.map((metric) => {
      const Icon = metric.icon;
      const tone = financeMetricTones[metric.tone] || financeMetricTones.neutral;
      return (
        <div key={metric.key || metric.label} className={cn('min-w-0 rounded-lg border px-3 py-3', tone)}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase text-slate-500">{metric.label}</div>
              <div className="mt-1 truncate text-lg font-bold tracking-normal" title={metric.valueTitle || undefined}>
                {metric.value}
              </div>
            </div>
            {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />}
          </div>
          {metric.detail && <div className="mt-1 text-xs leading-4 text-slate-600">{metric.detail}</div>}
        </div>
      );
    })}
  </div>
);

export const FinanceStageFlow = ({ stages = [], className }) => {
  const max = Math.max(...stages.map((stage) => Math.abs(Number(stage.value || 0))), 1);
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-slate-200 bg-slate-50/60 p-3', className)}>
      <div className="grid min-w-[680px] gap-2" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(130px, 1fr))` }}>
        {stages.map((stage, index) => (
          <div key={stage.key || stage.label} className="relative min-w-0 rounded-md bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-semibold uppercase text-slate-500">{stage.label}</span>
              {index < stages.length - 1 && <span className="text-slate-300" aria-hidden="true">→</span>}
            </div>
            <div className="mt-1 font-semibold tabular-nums text-slate-950">{stage.displayValue ?? formatMoney(stage.value)}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={cn('h-full rounded-full', stage.barClassName || 'bg-blue-600')} style={{ width: `${Math.min(100, Math.abs(Number(stage.value || 0)) / max * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const FinanceSection = ({ title, description, eyebrow, actions, children, className, contentClassName }) => (
  <section className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm', className)}>
    <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="text-[11px] font-semibold uppercase text-blue-700">{eyebrow}</div>}
        <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
        {description && <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
    <div className={cn('p-4', contentClassName)}>{children}</div>
  </section>
);

export const FinanceVisibilityNotice = ({ message = 'Finanční údaje jsou skryté podle vašich oprávnění.' }) => (
  <div className="flex items-start gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
    <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
    <div><div className="font-medium text-slate-800">Omezený finanční pohled</div><p className="mt-0.5 text-xs leading-5">{message}</p></div>
  </div>
);

export const FinanceDefinitionNote = ({ children, warning = false }) => {
  const Icon = warning ? AlertTriangle : Info;
  return (
    <div className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-5', warning ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-blue-100 bg-blue-50/60 text-blue-900')}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
};
