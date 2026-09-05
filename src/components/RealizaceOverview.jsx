import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowUpRight, Calendar, CircleDollarSign, FileText, MapPin, UserCheck, Users } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';
import { formatCurrency } from '@/lib/utils';
import { formatRealizationDate, getRealizationAttention } from '@/lib/realizationOverview';

export default function RealizaceOverview({ realization, linkedProjectCode, canEdit = false, onEdit }) {
  const { userRole, memberId, hasPermission, isPrivateMode } = useAuth();
  const { canViewAmounts } = getFinancialVisibility(userRole);
  const [myReward, setMyReward] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setMyReward(null); setShareError(false);
    if (canViewAmounts || !memberId || !realization?.id) { setShareLoading(false); return; }
    let active = true;
    setShareLoading(true);
    Promise.resolve(supabase.rpc('get_my_realization_reward', { p_realization_id: realization.id }))
      .then(({ data, error }) => { if (active) { setMyReward(error ? null : data); setShareError(Boolean(error)); } })
      .catch(() => { if (active) setShareError(true); })
      .finally(() => { if (active) setShareLoading(false); });
    return () => { active = false; };
  }, [canViewAmounts, memberId, realization?.id, retry]);

  if (!realization) return null;
  const fields = [
    { label: 'Vedoucí realizace', value: realization.lead_person?.name || 'Nepřiřazen', icon: UserCheck },
    { label: 'Investor', value: realization.investor?.name || 'Neuveden', icon: Users, to: realization.investor?.id && hasPermission('subjects', 'can_read') ? `/subjects/${realization.investor.id}` : null },
    { label: 'Zahájení', value: formatRealizationDate(realization.start_date), icon: Calendar },
    { label: 'Plánované dokončení', value: formatRealizationDate(realization.planned_end_date, 'Bez termínu'), icon: Calendar },
    { label: 'Skutečné dokončení', value: formatRealizationDate(realization.actual_end_date, ['Dokončeno', 'Předáno'].includes(realization.status) ? 'Neuvedeno' : 'Dosud nedokončeno'), icon: Calendar },
    { label: 'Typ realizace', value: realization.type || 'Neuveden', icon: FileText },
    { label: 'Místo realizace', value: realization.location_address || 'Adresa neuvedena', icon: MapPin },
    ...(realization.linked_project_id && hasPermission('projects', 'can_read') ? [{ label: 'Navazující projekt', value: linkedProjectCode || 'Otevřít projekt', icon: FileText, to: `/projects/${realization.linked_project_id}` }] : []),
  ];
  const attention = getRealizationAttention(realization);

  return <div className="space-y-5">
    {!canViewAmounts && memberId && <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CircleDollarSign className="h-5 w-5 text-primary" />Moje odměna</CardTitle></CardHeader><CardContent>
      {shareError ? <div role="alert" className="text-sm text-amber-800">Odměnu se nepodařilo načíst. <Button variant="link" onClick={() => setRetry(value => value + 1)}>Zkusit znovu</Button></div> : <>
        <div className="text-2xl font-semibold">{shareLoading ? 'Načítám…' : isPrivateMode ? 'Skryto' : myReward?.has_reward ? formatCurrency(Number(myReward.net_reward || 0)) : 'Nestanovena'}</div>
        {!isPrivateMode && myReward?.has_reward && <p className="mt-1 text-sm text-muted-foreground">{myReward.share_type === 'percent' ? `Podíl ${myReward.share_value} %` : 'Fixní odměna'}{Number(myReward.sponsored_labor_deduction || 0) > 0 ? ', po odpočtu sponzorované práce' : ''}</p>}
      </>}
    </CardContent></Card>}
    <div className={attention.length ? 'grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]' : ''}>
      <Card>
        <CardHeader className="px-5 pb-2 pt-5"><h2 className="text-base font-semibold">Informace o realizaci</h2></CardHeader>
        <CardContent className="px-5 pb-5">
          {realization.description && <p className="mb-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{realization.description}</p>}
          <dl className="grid gap-x-6 sm:grid-cols-2">{fields.map(({ label, value, icon: Icon, to }) => <div key={label} className="min-w-0 border-t py-3"><dt className="flex items-center gap-2 text-xs text-muted-foreground"><Icon size={14} />{label}</dt><dd className="mt-1 break-words text-sm font-medium">{to ? <Link className="inline-flex min-h-6 items-center gap-1 text-primary hover:underline" to={to}>{value}<ArrowUpRight size={14} className="shrink-0" /></Link> : value}</dd></div>)}</dl>
        </CardContent>
      </Card>
      {attention.length > 0 && <aside className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-950"><AlertTriangle size={17} />K dořešení</h2>
        <ul className="mt-3 list-disc space-y-2 pl-4 text-sm leading-relaxed text-amber-900">{attention.map(item => <li key={item}>{item}</li>)}</ul>
        {canEdit && onEdit && <Button className="mt-4 min-h-11" variant="outline" onClick={onEdit}>Upravit údaje realizace</Button>}
      </aside>}
    </div>
  </div>;
}
