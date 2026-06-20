import React from 'react';
import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export const DATAVIZ_COLORS = {
  primary: '#2563eb',
  cyan: '#0891b2',
  emerald: '#059669',
  amber: '#d97706',
  rose: '#e11d48',
  violet: '#7c3aed',
  slate: '#64748b',
  indigo: '#4f46e5',
  lime: '#65a30d',
};

export const DATAVIZ_PALETTE = [
  DATAVIZ_COLORS.primary,
  DATAVIZ_COLORS.cyan,
  DATAVIZ_COLORS.emerald,
  DATAVIZ_COLORS.amber,
  DATAVIZ_COLORS.rose,
  DATAVIZ_COLORS.violet,
  DATAVIZ_COLORS.indigo,
  DATAVIZ_COLORS.slate,
];

export const getVizColor = (index = 0) => DATAVIZ_PALETTE[index % DATAVIZ_PALETTE.length];

export const formatVizNumber = (value, options = {}) =>
  new Intl.NumberFormat('cs-CZ', options).format(Number(value) || 0);

export const formatVizCurrency = (value, options = {}) =>
  new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    ...options,
  }).format(Number(value) || 0);

export const formatVizPercent = (value, options = {}) =>
  `${formatVizNumber(value, { maximumFractionDigits: 0, ...options })} %`;

export const DataVizCard = ({
  title,
  description,
  icon: Icon = BarChart3,
  action,
  children,
  className,
  contentClassName,
}) => (
  <section className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
    <header className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-950">{title}</h3>
          {description ? <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
    <div className={cn('p-5', contentClassName)}>{children}</div>
  </section>
);

export const DataVizEmptyState = ({ label = 'Žádná data k zobrazení.', className }) => (
  <div className={cn('flex min-h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm text-slate-500', className)}>
    {label}
  </div>
);

export const StatusDonutChart = ({
  data,
  total,
  centerLabel = 'Celkem',
  emptyLabel,
  valueFormatter = formatVizNumber,
  className,
}) => {
  const safeTotal = Number(total) || 0;
  const items = (data || [])
    .map((item, index) => ({
      ...item,
      count: Number(item.count ?? item.value ?? 0) || 0,
      label: item.label || item.name || item.status || 'Bez názvu',
      color: item.color || getVizColor(index),
    }))
    .filter((item) => item.count > 0);

  if (!safeTotal || items.length === 0) {
    return <DataVizEmptyState label={emptyLabel} className={className} />;
  }

  let cursor = 0;
  const gradient = items
    .map((item) => {
      const start = cursor;
      const end = cursor + (item.count / safeTotal) * 100;
      cursor = end;
      return `${item.color} ${start}% ${end}%`;
    })
    .join(', ');

  return (
    <div className={cn('grid gap-5 md:grid-cols-[auto,1fr] md:items-center', className)}>
      <div className="relative mx-auto h-36 w-36 shrink-0 rounded-full shadow-inner" style={{ background: `conic-gradient(${gradient})` }} aria-label={`${centerLabel}: ${safeTotal}`}>
        <div className="absolute inset-4 flex flex-col items-center justify-center rounded-full bg-white text-center shadow-sm">
          <span className="text-3xl font-semibold tracking-tight text-slate-950">{valueFormatter(safeTotal)}</span>
          <span className="mt-1 text-xs font-medium text-slate-500">{centerLabel}</span>
        </div>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const percentage = safeTotal ? (item.count / safeTotal) * 100 : 0;
          return (
            <div key={item.label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="truncate font-medium text-slate-700">{item.label}</span>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-slate-950">{formatVizNumber(item.count)}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full" style={{ width: `${Math.max(percentage, 2)}%`, backgroundColor: item.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const VizTooltip = ({ active, payload, label, valueFormatter = formatVizNumber }) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {label ? <div className="mb-1 font-semibold text-slate-900">{label}</div> : null}
      <div className="space-y-1">
        {payload.map((item) => (
          <div key={`${item.dataKey}-${item.name}`} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}
            </span>
            <span className="font-semibold tabular-nums text-slate-950">{valueFormatter(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};


export const toneToVizClasses = (tone = 'blue') => {
  const tones = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    primary: 'border-blue-100 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    green: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    orange: 'border-orange-100 bg-orange-50 text-orange-700',
    rose: 'border-rose-100 bg-rose-50 text-rose-700',
    red: 'border-rose-100 bg-rose-50 text-rose-700',
    violet: 'border-violet-100 bg-violet-50 text-violet-700',
    purple: 'border-violet-100 bg-violet-50 text-violet-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    default: 'border-slate-200 bg-slate-50 text-slate-700',
  };
  return tones[tone] || tones.blue;
};

export const DataVizMetricCard = ({
  icon: Icon = BarChart3,
  label,
  title,
  value,
  detail,
  subtitle,
  trend,
  tone = 'blue',
  as: Component = 'div',
  className,
  iconClassName,
  ...props
}) => (
  <Component
    className={cn(
      'group flex min-h-[112px] w-full items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md',
      className
    )}
    {...props}
  >
    <div className="min-w-0 flex-1">
      <p className="truncate text-xs font-semibold uppercase tracking-[0.02em] text-slate-500">{label || title}</p>
      <div className="mt-2 break-words text-2xl font-semibold leading-tight tracking-tight text-slate-950">{value}</div>
      {(detail || subtitle) ? <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-500">{detail || subtitle}</p> : null}
      {trend !== undefined && trend !== null ? (
        <span className={cn('mt-3 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', Number(trend) >= 0 ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-rose-100 bg-rose-50 text-rose-700')}>
          {Number(trend) > 0 ? '+' : ''}{trend}%
        </span>
      ) : null}
    </div>
    <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border', toneToVizClasses(tone), iconClassName)}>
      <Icon className="h-5 w-5" />
    </span>
  </Component>
);
export const MiniBarList = ({ items, valueFormatter = formatVizCurrency, className }) => {
  const normalized = (items || []).filter((item) => Number(item.value) > 0);
  const max = Math.max(...normalized.map((item) => Number(item.value) || 0), 1);

  if (!normalized.length) {
    return <DataVizEmptyState className={className} />;
  }

  return (
    <div className={cn('space-y-3', className)}>
      {normalized.map((item, index) => {
        const color = item.color || getVizColor(index);
        const width = ((Number(item.value) || 0) / max) * 100;
        return (
          <div key={item.label} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-medium uppercase tracking-wide text-slate-600">{item.label}</span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-900">{valueFormatter(item.value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full" style={{ width: `${Math.max(width, 2)}%`, backgroundColor: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
