import React from 'react';
import { AlertTriangle, Ban, CheckCircle2, Clock, FileText, Upload, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DataVizMetricCard } from '@/components/ui/data-viz';
import { formatMoney } from '@/lib/financePresentation';

export const payoutStatusMeta = {
  pending: {
    label: 'Čeká na schválení',
    icon: Clock,
    className: 'border-amber-200 bg-amber-50 text-amber-700'
  },
  approved: {
    label: 'Čeká na fakturu',
    icon: Upload,
    className: 'border-blue-200 bg-blue-50 text-blue-700'
  },
  invoice_uploaded: {
    label: 'Faktura nahrána',
    icon: FileText,
    className: 'border-slate-200 bg-slate-100 text-slate-700'
  },
  paid: {
    label: 'Vyplaceno',
    icon: CheckCircle2,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700'
  },
  rejected: {
    label: 'Zamítnuto',
    icon: XCircle,
    className: 'border-red-200 bg-red-50 text-red-700'
  }
};

payoutStatusMeta.cancelled = {
  label: 'Stornováno',
  icon: Ban,
  className: 'border-slate-300 bg-slate-100 text-slate-700'
};

export const formatCurrency = formatMoney;

export const formatHours = (value) =>
  `${Number(value || 0).toLocaleString('cs-CZ', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} h`;

export const PayoutStatusBadge = ({ status, approvedWithoutInvoice = false, className }) => {
  const meta = status === 'approved' && approvedWithoutInvoice ? { ...payoutStatusMeta.approved, label: 'Připraveno k úhradě' } : payoutStatusMeta[status] || {
    label: status || 'Neznámý stav',
    icon: AlertTriangle,
    className: 'border-slate-200 bg-slate-50 text-slate-700'
  };
  const Icon = meta.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        'h-7 gap-1.5 rounded-full px-2.5 text-xs font-semibold',
        meta.className,
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </Badge>
  );
};

export const PayoutMetricCard = ({ icon: Icon, label, value, detail, tone = 'blue' }) => (
  <DataVizMetricCard icon={Icon} label={label} value={value} detail={detail} tone={tone} />
);

export const PayoutPanel = ({ title, description, actions, children, className }) => (
  <section className={cn('overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
    {(title || description || actions) && (
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          {title && <h2 className="text-base font-semibold text-slate-950">{title}</h2>}
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    )}
    {children}
  </section>
);

export const EmptyPayoutState = ({ icon: Icon = FileText, title, description, action }) => (
  <div className="flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
    <div className="rounded-full bg-slate-100 p-4 text-slate-400">
      <Icon className="h-7 w-7" />
    </div>
    <h3 className="mt-4 text-base font-semibold text-slate-950">{title}</h3>
    {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);
