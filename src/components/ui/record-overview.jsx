import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const RecordOverviewPanel = ({ title, description, badge, children, aside, className }) => (
  <section className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm', className)}>
    <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
        {description && <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>}
      </div>
      {badge}
    </div>
    <div className={cn('grid gap-4 p-4', aside && 'xl:grid-cols-[minmax(0,1fr)_300px]')}>
      <div className="min-w-0">{children}</div>
      {aside && <div className="min-w-0">{aside}</div>}
    </div>
  </section>
);

export const RecordOverviewGrid = ({ children, className }) => (
  <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>{children}</div>
);

export const RecordOverviewItem = ({ icon: Icon, label, value, detail, tone = 'neutral' }) => {
  const displayValue = value === null || value === undefined || value === '' ? '—' : value;
  const tones = {
    neutral: 'border-slate-200 bg-slate-50/70 text-slate-700',
    info: 'border-blue-100 bg-blue-50/70 text-blue-800',
    positive: 'border-emerald-100 bg-emerald-50/70 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    negative: 'border-red-200 bg-red-50 text-red-800',
  };

  return (
    <div className={cn('min-w-0 rounded-md border px-3 py-2.5', tones[tone] || tones.neutral)}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase text-slate-500">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-base font-semibold tabular-nums text-slate-950" title={String(displayValue)}>{displayValue}</div>
      {detail && <p className="mt-0.5 truncate text-xs text-slate-500" title={detail}>{detail}</p>}
    </div>
  );
};

export const RecordAttentionList = ({ items = [] }) => {
  const activeItems = items.filter(Boolean);
  const hasWarning = activeItems.some((item) => item.tone === 'warning' || item.tone === 'negative');
  const Icon = hasWarning ? AlertTriangle : CheckCircle2;

  return (
    <div className={cn('h-full rounded-md border p-3', hasWarning ? 'border-amber-200 bg-amber-50/70' : 'border-emerald-100 bg-emerald-50/70')}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', hasWarning ? 'text-amber-700' : 'text-emerald-700')} aria-hidden="true" />
        <h3 className="text-sm font-semibold text-slate-950">Pozornost</h3>
      </div>
      <div className="mt-3 space-y-2">
        {activeItems.length ? activeItems.map((item) => (
          <div key={item.label} className="flex items-start justify-between gap-3 text-xs">
            <span className="text-slate-600">{item.label}</span>
            <span className={cn('shrink-0 font-semibold tabular-nums', item.tone === 'negative' ? 'text-red-700' : item.tone === 'warning' ? 'text-amber-800' : 'text-slate-900')}>{item.value}</span>
          </div>
        )) : <p className="text-xs text-emerald-800">Zakázka nemá evidované kritické upozornění.</p>}
      </div>
    </div>
  );
};
