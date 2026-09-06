import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarCheck2, CalendarDays, CheckCircle2, FileText, List, Target, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { crmGoalProgress, getCrmMonthRange } from '@/lib/crmActivity';
import { formatMoney } from '@/lib/financePresentation';
import CRMActivityMonthCalendar from '@/components/CRMActivityMonthCalendar';

const monthValue = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const formatDate = (value) => value ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '-';
const emptyGoal = (month) => ({ member_id: '', period_start: `${month}-01`, activity_target: 0, meeting_target: 0, offer_target: 0, accepted_offer_target: 0, revenue_target: 0, notes: '' });

const CRMSalesActivities = () => {
  const { hasPermission, memberId } = useAuth();
  const { toast } = useToast();
  const canAdmin = hasPermission('crm', 'can_admin');
  const [month, setMonth] = useState(monthValue());
  const [activities, setActivities] = useState([]);
  const [performance, setPerformance] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goal, setGoal] = useState(emptyGoal(month));
  const [savingGoal, setSavingGoal] = useState(false);
  const [activityView, setActivityView] = useState('calendar');
  const [activityType, setActivityType] = useState('all');
  const [activityMember, setActivityMember] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to, nextExclusive } = getCrmMonthRange(month);
    let activityQuery = supabase.from('crm_activities')
      .select('id, title, type, status, starts_at, due_at, outcome, next_step, external_web_link, assigned:assigned_member_id(id, name), opportunity:opportunity_id(id, number, title)')
      .or(`and(starts_at.gte.${from}T00:00:00,starts_at.lt.${nextExclusive}T00:00:00),and(starts_at.is.null,due_at.gte.${from}T00:00:00,due_at.lt.${nextExclusive}T00:00:00)`)
      .order('starts_at', { ascending: false });
    if (!canAdmin && memberId) activityQuery = activityQuery.eq('assigned_member_id', memberId);
    const [activitiesRes, membersRes, performanceRes] = await Promise.all([
      activityQuery,
      canAdmin ? supabase.from('members').select('id, name').not('auth_user_id', 'is', null).order('name') : Promise.resolve({ data: [], error: null }),
      canAdmin ? supabase.rpc('get_crm_sales_performance', { p_from: from, p_to: to }) : Promise.resolve({ data: [], error: null }),
    ]);
    const error = activitiesRes.error || membersRes.error || performanceRes.error;
    if (error) toast({ title: 'Přehled aktivit se nepodařilo načíst', description: error.message, variant: 'destructive' });
    setActivities(activitiesRes.data || []);
    setMembers(membersRes.data || []);
    setPerformance(performanceRes.data || []);
    setLoading(false);
  }, [canAdmin, memberId, month, toast]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => performance.reduce((sum, row) => ({
    activities: sum.activities + Number(row.activities_count || 0),
    completed: sum.completed + Number(row.completed_activities_count || 0),
    meetings: sum.meetings + Number(row.meetings_count || 0),
    accepted: sum.accepted + Number(row.accepted_offers_count || 0),
    revenue: sum.revenue + Number(row.accepted_revenue || 0),
  }), { activities: 0, completed: 0, meetings: 0, accepted: 0, revenue: 0 }), [performance]);

  const activityTypes = useMemo(() => [...new Set(activities.map((item) => item.type).filter(Boolean))].sort(), [activities]);
  const filteredActivities = useMemo(() => activities.filter((activity) => (
    (activityType === 'all' || activity.type === activityType)
    && (activityMember === 'all' || activity.assigned?.id === activityMember)
  )), [activities, activityMember, activityType]);

  const openGoal = (row) => {
    setGoal({
      ...emptyGoal(month),
      member_id: row.member_id,
      activity_target: row.activity_target || 0,
      meeting_target: row.meeting_target || 0,
      offer_target: row.offer_target || 0,
      accepted_offer_target: row.accepted_offer_target || 0,
      revenue_target: row.revenue_target || 0,
    });
    setGoalOpen(true);
  };

  const saveGoal = async (event) => {
    event.preventDefault();
    setSavingGoal(true);
    const payload = {
      ...goal,
      created_by_member_id: memberId,
      activity_target: Number(goal.activity_target || 0),
      meeting_target: Number(goal.meeting_target || 0),
      offer_target: Number(goal.offer_target || 0),
      accepted_offer_target: Number(goal.accepted_offer_target || 0),
      revenue_target: Number(goal.revenue_target || 0),
      notes: goal.notes.trim() || null,
    };
    const { error } = await supabase.from('crm_sales_goals').upsert(payload, { onConflict: 'member_id,period_start' });
    setSavingGoal(false);
    if (error) {
      toast({ title: 'Cíl se nepodařilo uložit', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Měsíční cíl byl uložen' });
    setGoalOpen(false);
    await load();
  };

  return (
    <div className="app-page space-y-6">
      <PageHeader
        icon={BarChart3}
        title="Aktivity a cíle obchodu"
        description="Společný přehled kontaktů, schůzek, nabídek a plnění měsíčních cílů obchodníků."
        actions={<div className="flex items-center gap-2"><Label htmlFor="crm-performance-month" className="sr-only">Měsíc</Label><Input id="crm-performance-month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-[170px]" /></div>}
      />

      {canAdmin && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ['Aktivity', totals.activities, CalendarCheck2],
          ['Dokončeno', totals.completed, CheckCircle2],
          ['Schůzky', totals.meetings, Users],
          ['Přijaté nabídky', totals.accepted, FileText],
          ['Přijatá hodnota', formatMoney(totals.revenue), Target],
        ].map(([label, value, Icon]) => <Card key={label}><CardContent className="flex items-center gap-3 p-4"><div className="rounded-full bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold text-slate-950">{value}</p></div></CardContent></Card>)}
      </div>}

      {canAdmin && <Card>
        <CardHeader><CardTitle>Plnění obchodního týmu</CardTitle><CardDescription>Cíle se nastavují po měsících. Výsledky se počítají z aktivit a přijatých nabídek.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Obchodník</TableHead><TableHead>Aktivity</TableHead><TableHead>Schůzky</TableHead><TableHead>Nabídky</TableHead><TableHead>Přijaté</TableHead><TableHead>Hodnota</TableHead><TableHead className="text-right">Cíl</TableHead></TableRow></TableHeader><TableBody>
            {loading ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Načítám výsledky…</TableCell></TableRow> : performance.length === 0 ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Pro vybraný měsíc nejsou dostupná data.</TableCell></TableRow> : performance.map((row) => (
              <TableRow key={row.member_id}>
                <TableCell className="font-semibold">{row.member_name}</TableCell>
                <TableCell><div className="min-w-[110px]"><div className="mb-1 text-xs">{row.completed_activities_count} / {row.activity_target || '—'}</div><Progress className="h-1.5" value={crmGoalProgress(row.completed_activities_count, row.activity_target)} /></div></TableCell>
                <TableCell>{row.completed_meetings_count} / {row.meeting_target || '—'}</TableCell>
                <TableCell>{row.offers_count} / {row.offer_target || '—'}</TableCell>
                <TableCell>{row.accepted_offers_count} / {row.accepted_offer_target || '—'}</TableCell>
                <TableCell>{formatMoney(row.accepted_revenue)}<div className="text-xs text-muted-foreground">z {formatMoney(row.revenue_target)}</div></TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => openGoal(row)}><Target className="mr-2 h-4 w-4" />Nastavit</Button></TableCell>
              </TableRow>
            ))}
          </TableBody></Table></div>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader className="gap-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>{canAdmin ? 'Aktivity týmu' : 'Obchodní aktivity'}</CardTitle><CardDescription>Schůzky, úkoly a další práce zaznamenaná u obchodních případů.</CardDescription></div><div className="flex rounded-lg border bg-slate-50 p-1"><Button size="sm" variant={activityView === 'calendar' ? 'secondary' : 'ghost'} onClick={() => setActivityView('calendar')}><CalendarDays className="mr-2 h-4 w-4" />Kalendář</Button><Button size="sm" variant={activityView === 'list' ? 'secondary' : 'ghost'} onClick={() => setActivityView('list')}><List className="mr-2 h-4 w-4" />Seznam</Button></div></div><div className="flex flex-wrap gap-2"><select aria-label="Typ aktivity" value={activityType} onChange={(event) => setActivityType(event.target.value)} className="h-9 rounded-md border bg-white px-3 text-sm"><option value="all">Všechny typy</option>{activityTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>{canAdmin && <select aria-label="Obchodník" value={activityMember} onChange={(event) => setActivityMember(event.target.value)} className="h-9 rounded-md border bg-white px-3 text-sm"><option value="all">Všichni obchodníci</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}<Badge variant="outline" className="bg-white">{filteredActivities.length} aktivit</Badge></div></CardHeader>
        <CardContent className={activityView === 'calendar' ? 'p-0' : 'space-y-3'}>
          {loading ? <p className="py-6 text-center text-sm text-muted-foreground">Načítám aktivity…</p> : filteredActivities.length === 0 ? <p className="m-4 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Pro zvolený měsíc a filtry nejsou evidované žádné aktivity.</p> : activityView === 'calendar' ? <CRMActivityMonthCalendar month={month} activities={filteredActivities} /> : filteredActivities.map((activity) => (
            <div key={activity.id} className="flex flex-col gap-3 rounded-lg border bg-slate-50 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-950">{activity.title}</span><Badge variant="outline" className="bg-white">{activity.type}</Badge><Badge variant={activity.status === 'completed' ? 'secondary' : 'outline'}>{activity.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{formatDate(activity.starts_at || activity.due_at)} · {activity.assigned?.name || 'Nepřiřazeno'}</p>{(activity.outcome || activity.next_step) && <p className="mt-2 text-sm text-slate-700">{activity.outcome || activity.next_step}</p>}</div>
              {activity.opportunity && <Button asChild variant="outline" size="sm"><Link to={`/crm/opportunities/${activity.opportunity.id}`}>{activity.opportunity.number || 'OP'} · {activity.opportunity.title}</Link></Button>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={goalOpen} onOpenChange={setGoalOpen}><DialogContent><DialogHeader><DialogTitle>Měsíční cíl obchodníka</DialogTitle><DialogDescription>Nastavte měřitelné cíle pro {month}. Aktuální výsledky se doplní automaticky.</DialogDescription></DialogHeader><form onSubmit={saveGoal} className="space-y-4"><div className="space-y-2"><Label>Obchodník</Label><select required value={goal.member_id} onChange={(event) => setGoal((current) => ({ ...current, member_id: event.target.value }))} className="h-10 w-full rounded-md border bg-white px-3 text-sm">{members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="grid gap-4 sm:grid-cols-2">{[['activity_target', 'Dokončené aktivity'], ['meeting_target', 'Dokončené schůzky'], ['offer_target', 'Vytvořené nabídky'], ['accepted_offer_target', 'Přijaté nabídky'], ['revenue_target', 'Přijatá hodnota (Kč)']].map(([key, label]) => <div key={key} className="space-y-2"><Label>{label}</Label><Input min="0" step={key === 'revenue_target' ? '1000' : '1'} type="number" value={goal[key]} onChange={(event) => setGoal((current) => ({ ...current, [key]: event.target.value }))} /></div>)}</div><div className="space-y-2"><Label>Poznámka</Label><Textarea value={goal.notes} onChange={(event) => setGoal((current) => ({ ...current, notes: event.target.value }))} /></div><DialogFooter><Button type="button" variant="outline" onClick={() => setGoalOpen(false)}>Zrušit</Button><Button disabled={savingGoal}>{savingGoal ? 'Ukládám…' : 'Uložit cíl'}</Button></DialogFooter></form></DialogContent></Dialog>
    </div>
  );
};

export default CRMSalesActivities;
