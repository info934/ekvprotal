import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Receipt } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FinanceMetricStrip, FinanceStageFlow } from '@/components/finance/FinanceWorkspace';
import { formatMoney, formatPercent, getFinanceErrorMessage } from '@/lib/financePresentation';

const coverageLabels = {
  not_configured: 'Neevidováno',
  not_invoiced: 'Nevyfakturováno',
  partially_invoiced: 'Částečně fakturováno',
  invoiced_unpaid: 'Čeká na úhradu',
  partially_paid: 'Částečně uhrazeno',
  fully_paid: 'Plně uhrazeno',
};

const milestoneStatusLabels = {
  planned: 'Plánováno', ready: 'Připraveno', invoiced: 'Vyfakturováno',
  partially_paid: 'Částečně uhrazeno', completed: 'Dokončeno',
  overdue: 'Po termínu', cancelled: 'Stornováno',
};

const closedStatuses = new Set(['invoiced', 'partially_paid', 'completed', 'cancelled']);
const dateValue = (milestone) => milestone.planned_issue_date || milestone.performance_date || milestone.due_date || null;
const formatDate = (value) => value
  ? new Date(`${value}T12:00:00`).toLocaleDateString('cs-CZ')
  : 'Termín neurčen';

const BillingOverviewSummary = ({ entityType, entityId, onOpenDetails, className = '' }) => {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    setError('');
    const { data, error: loadError } = await supabase.rpc('get_entity_billing_summary', {
      p_entity_type: entityType,
      p_entity_id: entityId,
    });
    if (loadError) {
      setError(getFinanceErrorMessage(loadError));
      setLoading(false);
      return;
    }
    setSummary(data);
    setLoading(false);
  }, [entityId, entityType]);

  useEffect(() => { load(); }, [load]);

  const milestones = useMemo(() => summary?.milestones || [], [summary]);
  const activeMilestones = useMemo(() => milestones
    .filter((item) => !closedStatuses.has(item.status))
    .sort((left, right) => {
      const leftDate = dateValue(left) || '9999-12-31';
      const rightDate = dateValue(right) || '9999-12-31';
      return leftDate.localeCompare(rightDate) || Number(left.installment_number || 0) - Number(right.installment_number || 0);
    }), [milestones]);
  const nextMilestone = activeMilestones[0] || null;
  const coverageStatus = summary?.status || 'not_configured';

  if (loading) {
    return (
      <section className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
        <div className="flex items-center justify-between"><Skeleton className="h-5 w-44" /><Skeleton className="h-8 w-24" /></div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20" />)}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 ${className}`}>
        <div className="flex items-start gap-2 text-sm text-red-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div><div className="font-semibold">Fakturaci se nepodařilo načíst</div><div className="text-xs text-red-700">{error}</div></div>
        </div>
        <Button size="sm" variant="outline" onClick={load}>Zkusit znovu</Button>
      </section>
    );
  }

  return (
    <section className={`space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-md border border-blue-100 bg-blue-50 p-2 text-blue-700"><Receipt className="h-5 w-5" /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-950">Fakturace a etapy</h3>
              <Badge variant={coverageStatus === 'fully_paid' ? 'success' : 'secondary'}>{coverageLabels[coverageStatus] || coverageStatus}</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">Rychlý přehled plnění, vystavených faktur a přijatých úhrad.</p>
          </div>
        </div>
        {onOpenDetails && <Button size="sm" variant="outline" onClick={onOpenDetails}>Otevřít finance <ArrowRight className="ml-2 h-4 w-4" /></Button>}
      </div>

      {summary?.warning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{summary.warning_message || 'Fakturace vyžaduje kontrolu.'}</span>
        </div>
      )}

      <FinanceMetricStrip metrics={[
        { label: 'Fakturační etapy', value: Number(summary?.plan_count || 0), detail: `${activeMilestones.length} zbývá dokončit`, tone: activeMilestones.length ? 'plan' : 'neutral', icon: CalendarClock },
        { label: 'Vyfakturováno bez DPH', value: formatPercent(summary?.invoice_coverage_percent), detail: formatMoney(summary?.invoiced_amount_excl_vat ?? summary?.invoiced_amount), tone: 'plan', icon: Receipt },
        { label: 'Uhrazené plnění bez DPH', value: formatPercent(summary?.payment_coverage_percent), detail: formatMoney(summary?.paid_amount_excl_vat_equivalent), tone: 'positive', icon: CheckCircle2 },
        { label: 'Nejbližší etapa', value: nextMilestone ? formatDate(dateValue(nextMilestone)) : 'Žádná', detail: nextMilestone?.name || 'Bez otevřené etapy', tone: Number(summary?.overdue_milestone_count || 0) ? 'warning' : 'neutral', icon: CalendarClock },
      ]} className="2xl:grid-cols-4" />

      <FinanceStageFlow stages={[
        { label: 'Hodnota bez DPH', value: summary?.contract_amount_excl_vat ?? summary?.contract_amount, barClassName: 'bg-slate-500' },
        { label: 'Naplánováno bez DPH', value: summary?.planned_amount_excl_vat ?? summary?.planned_amount, barClassName: 'bg-blue-500' },
        { label: 'Vystaveno bez DPH', value: summary?.invoiced_amount_excl_vat ?? summary?.invoiced_amount, barClassName: 'bg-indigo-500' },
        { label: 'Uhrazené plnění bez DPH', value: summary?.paid_amount_excl_vat_equivalent, barClassName: 'bg-emerald-500' },
      ]} />

      {activeMilestones.length > 0 && (
        <div className="grid gap-2 lg:grid-cols-3">
          {activeMilestones.slice(0, 3).map((milestone) => (
            <div key={milestone.id} className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold text-slate-900">{milestone.installment_number}. {milestone.name}</span>
                <Badge variant="outline" className="shrink-0 text-[10px]">{milestoneStatusLabels[milestone.status] || milestone.status}</Badge>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>{formatDate(dateValue(milestone))}</span>
                <span className="tabular-nums text-slate-700">{formatMoney(milestone.amount_incl_vat)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default BillingOverviewSummary;
