import { useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { planningAvailabilityKey, planningDeletionItems } from '@/lib/operationsHelpers';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { format, parseISO } from 'date-fns';
import { cs } from 'date-fns/locale';
import {
  BedDouble,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  GanttChart,
  AlertCircle,
  Clock3,
  Flag,
  MapPin,
  Milestone,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Trash2,
} from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import {
  deleteAccommodation,
  deletePlanningDependency,
  deletePlanningItem,
  deleteTravelSegment,
  ensurePlanningPlan,
  listPlanningPlans,
  loadPlanningData,
  saveAccommodation,
  savePlanningDependency,
  savePlanningItem,
  saveTravelSegment,
  updatePlanningItemDates,
  checkPlanningItemAvailability,
  syncPlanningItemCalendar,
  syncPlanningPlanCalendar,
} from '@/lib/planningService';

const PlanningGantt = lazy(() => import('@/components/PlanningGantt'));

const TODAY = () => format(new Date(), 'yyyy-MM-dd');
const LOCAL_DATE_TIME = (hour = 8) => `${TODAY()}T${String(hour).padStart(2, '0')}:00`;
const toLocalDateTime = (value, fallbackHour = 8) => value
  ? format(parseISO(value), "yyyy-MM-dd'T'HH:mm")
  : LOCAL_DATE_TIME(fallbackHour);

const ITEM_STATUS = {
  planned: 'Plánováno',
  ready: 'Připraveno',
  in_progress: 'Probíhá',
  blocked: 'Blokováno',
  done: 'Dokončeno',
  cancelled: 'Zrušeno',
};

const ITEM_TYPE = {
  phase: 'Fáze',
  task: 'Úkol',
  milestone: 'Milník',
};

const TRAVEL_STATUS = {
  planned: 'Plánováno',
  confirmed: 'Potvrzeno',
  completed: 'Dokončeno',
  cancelled: 'Zrušeno',
};

const ACCOMMODATION_STATUS = {
  proposal: 'Návrh',
  approval: 'Ke schválení',
  booked: 'Rezervováno',
  completed: 'Dokončeno',
  cancelled: 'Zrušeno',
};

const emptyItem = () => ({
  item_type: 'task',
  name: '',
  description: '',
  start_date: TODAY(),
  end_date: TODAY(),
  start_at: LOCAL_DATE_TIME(8),
  end_at: LOCAL_DATE_TIME(17),
  progress: 0,
  status: 'planned',
  member_id: '',
  assignments: [],
  subcontractor_assignments: [],
  calendar_sync_enabled: false,
});

const emptyTravel = () => ({
  item_id: '',
  travel_date: TODAY(),
  departure_at: LOCAL_DATE_TIME(7),
  arrival_at: LOCAL_DATE_TIME(8),
  origin_label: '',
  destination_label: '',
  distance_km: '',
  duration_minutes: '',
  travel_mode: 'car',
  status: 'planned',
  overnight_recommended: false,
  overnight_required: false,
  notes: '',
});

const emptyAccommodation = () => ({
  item_id: '',
  guest_ids: [],
  hotel_name: '',
  address: '',
  check_in: TODAY(),
  check_out: format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'),
  status: 'proposal',
  booking_reference: '',
  notes: '',
});

const formatDate = (value) => value ? format(parseISO(value), 'd. M. yyyy', { locale: cs }) : '—';
const formatDateTime = (value) => value ? format(parseISO(value), 'd. M. yyyy HH:mm', { locale: cs }) : '—';

const getCalendarLink = (item) => Array.isArray(item?.calendar_link)
  ? item.calendar_link[0] || null
  : item?.calendar_link || null;

const CALENDAR_STATUS = {
  pending: 'Čeká na synchronizaci',
  syncing: 'Synchronizuje se',
  synced: 'Synchronizováno',
  error: 'Chyba synchronizace',
  disabled: 'Vypnuto',
};

const StatusBadge = ({ value, labels = ITEM_STATUS }) => {
  const variant = value === 'done' || value === 'completed' || value === 'booked'
    ? 'success'
    : value === 'blocked' || value === 'cancelled'
      ? 'destructive'
      : 'secondary';
  return <Badge variant={variant}>{labels[value] || value}</Badge>;
};

const Metric = ({ icon: Icon, label, value, tone = 'blue' }) => {
  const tones = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <Card className="rounded-md shadow-sm">
      <CardContent className="flex items-center gap-3 p-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-md ${tones[tone]}`}><Icon className="h-4 w-4" /></div>
        <div>
          <div className="text-xs text-slate-500">{label}</div>
          <div className="text-xl font-semibold text-slate-950">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
};

const ItemDialog = ({ open, value, items, members, subcontractors, onClose, onSave, onDelete, onCheckAvailability, onAvailabilityInvalidate, availability, saving }) => {
  const [form, setForm] = useState(emptyItem());
  const [savedAvailabilityKey, setSavedAvailabilityKey] = useState('');
  const availabilityKey = planningAvailabilityKey(form);
  const availabilityDirty = availabilityKey !== savedAvailabilityKey;

  useEffect(() => { onAvailabilityInvalidate(); }, [availabilityKey, onAvailabilityInvalidate]);

  useEffect(() => {
    if (!open) return;
    if (!value) {
      setForm(emptyItem());
      return;
    }
    const assignments = value.assignments?.length
      ? value.assignments.map(({ member, ...assignment }) => assignment)
      : value.member_id
        ? [{ member_id: value.member_id, role: '', allocation_percent: 100, planned_hours: '' }]
        : [];
    const nextForm = {
      ...emptyItem(),
      ...value,
      member_id: value.member_id || '',
      start_at: toLocalDateTime(value.start_at || `${value.start_date}T08:00`, 8),
      end_at: toLocalDateTime(value.end_at || `${value.end_date}T17:00`, 17),
      assignments,
      subcontractor_assignments: (value.subcontractor_assignments || []).map(({ subcontractor, ...assignment }) => assignment),
    };
    setForm(nextForm);
    setSavedAvailabilityKey(planningAvailabilityKey(nextForm));
  }, [open, value]);

  const update = (key, nextValue) => setForm((current) => ({ ...current, [key]: nextValue }));
  const setPrimaryMember = (memberId) => setForm((current) => {
    const assignments = memberId && !current.assignments.some((assignment) => assignment.member_id === memberId)
      ? [...current.assignments, { member_id: memberId, role: '', allocation_percent: 100, planned_hours: '' }]
      : current.assignments;
    return { ...current, member_id: memberId, assignments };
  });
  const toggleMember = (memberId, checked) => setForm((current) => {
    const assignments = checked
      ? [...current.assignments, { member_id: memberId, role: '', allocation_percent: 100, planned_hours: '' }]
      : current.assignments.filter((assignment) => assignment.member_id !== memberId);
    return { ...current, assignments, member_id: current.member_id === memberId && !checked ? assignments[0]?.member_id || '' : current.member_id };
  });
  const updateMemberAssignment = (memberId, key, nextValue) => setForm((current) => ({
    ...current,
    assignments: current.assignments.map((assignment) => assignment.member_id === memberId ? { ...assignment, [key]: nextValue } : assignment),
  }));
  const toggleSubcontractor = (subcontractorId, checked) => setForm((current) => ({
    ...current,
    subcontractor_assignments: checked
      ? [...current.subcontractor_assignments, { project_subcontractor_id: subcontractorId, role: '', allocation_percent: 100, planned_hours: '' }]
      : current.subcontractor_assignments.filter((assignment) => assignment.project_subcontractor_id !== subcontractorId),
  }));
  const updateSubcontractorAssignment = (subcontractorId, key, nextValue) => setForm((current) => ({
    ...current,
    subcontractor_assignments: current.subcontractor_assignments.map((assignment) => assignment.project_subcontractor_id === subcontractorId ? { ...assignment, [key]: nextValue } : assignment),
  }));
  const selectedMember = members.find((member) => member.id === form.member_id);
  const personalMailbox = selectedMember?.microsoft_calendar_email || selectedMember?.email;
  const calendarLink = getCalendarLink(value);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{form.id ? 'Upravit položku plánu' : 'Nová položka plánu'}</DialogTitle>
          <DialogDescription>Fáze seskupují práci, úkoly mají termín a milníky označují rozhodující okamžik.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Typ</Label>
            <Select value={form.item_type} onValueChange={(value) => update('item_type', value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(ITEM_TYPE).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Stav</Label>
            <Select value={form.status} onValueChange={(value) => update('status', value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(ITEM_STATUS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Název</Label>
            <Input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Např. Předání dokumentace" />
          </div>
          <div className="space-y-2">
            <Label>Začátek</Label>
            <Input type="datetime-local" step="900" value={form.start_at} onChange={(event) => update('start_at', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{form.item_type === 'milestone' ? 'Datum milníku' : 'Konec'}</Label>
            <Input type="datetime-local" step="900" value={form.item_type === 'milestone' ? form.start_at : form.end_at} disabled={form.item_type === 'milestone'} onChange={(event) => update('end_at', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Řešitel</Label>
            <Select value={form.member_id || 'none'} onValueChange={(value) => setPrimaryMember(value === 'none' ? '' : value)}>
              <SelectTrigger><SelectValue placeholder="Nepřiřazeno" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nepřiřazeno</SelectItem>
                {members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name || member.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/70 p-3 sm:col-span-2">
            <div>
              <div className="text-sm font-semibold text-slate-950">Interní zdroje a kapacita</div>
              <div className="text-xs text-slate-500">Vyberte více osob a určete jejich vytížení. Osobní kalendář hlavního řešitele se používá jen pro kontrolu dostupnosti.</div>
            </div>
            <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
              {members.map((member) => {
                const assignment = form.assignments.find((entry) => entry.member_id === member.id);
                return (
                  <div key={member.id} className="grid items-center gap-2 rounded-md border bg-white p-2 sm:grid-cols-[minmax(180px,1fr)_90px_100px]">
                    <label className="flex min-w-0 items-center gap-2 text-sm">
                      <Checkbox checked={Boolean(assignment)} onCheckedChange={(checked) => toggleMember(member.id, Boolean(checked))} />
                      <span className="truncate">{member.name || member.email}</span>
                      {form.member_id === member.id && <Badge variant="secondary">Hlavní</Badge>}
                    </label>
                    <Input aria-label={`Vytížení ${member.name || member.email} v procentech`} type="number" min="1" max="100" disabled={!assignment} value={assignment?.allocation_percent ?? 100} onChange={(event) => updateMemberAssignment(member.id, 'allocation_percent', event.target.value)} />
                    <Input aria-label={`Plánované hodiny ${member.name || member.email}`} type="number" min="0" step="0.5" disabled={!assignment} placeholder="Hodiny" value={assignment?.planned_hours ?? ''} onChange={(event) => updateMemberAssignment(member.id, 'planned_hours', event.target.value)} />
                  </div>
                );
              })}
            </div>
          </div>
          {subcontractors.length > 0 && (
            <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50/60 p-3 sm:col-span-2">
              <div>
                <div className="text-sm font-semibold text-slate-950">Subdodavatelé</div>
                <div className="text-xs text-slate-600">Kapacita je plánovací údaj a nemění finanční část subdodávky.</div>
              </div>
              <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                {subcontractors.map((subcontractor) => {
                  const assignment = form.subcontractor_assignments.find((entry) => entry.project_subcontractor_id === subcontractor.id);
                  return (
                    <div key={subcontractor.id} className="grid items-center gap-2 rounded-md border bg-white p-2 sm:grid-cols-[minmax(180px,1fr)_90px_100px]">
                      <label className="flex min-w-0 items-center gap-2 text-sm"><Checkbox checked={Boolean(assignment)} onCheckedChange={(checked) => toggleSubcontractor(subcontractor.id, Boolean(checked))} /><span className="truncate">{subcontractor.name || subcontractor.scope_of_work || 'Subdodavatel'}</span></label>
                      <Input aria-label="Vytížení subdodavatele v procentech" type="number" min="1" max="100" disabled={!assignment} value={assignment?.allocation_percent ?? 100} onChange={(event) => updateSubcontractorAssignment(subcontractor.id, 'allocation_percent', event.target.value)} />
                      <Input aria-label="Plánované hodiny subdodavatele" type="number" min="0" step="0.5" disabled={!assignment} placeholder="Hodiny" value={assignment?.planned_hours ?? ''} onChange={(event) => updateSubcontractorAssignment(subcontractor.id, 'planned_hours', event.target.value)} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="space-y-2 rounded-md border border-blue-100 bg-blue-50/60 p-3 sm:col-span-2">
            <label className="flex items-start gap-3">
              <Checkbox
                checked={Boolean(form.calendar_sync_enabled)}
                disabled={form.item_type === 'phase'}
                onCheckedChange={(checked) => update('calendar_sync_enabled', Boolean(checked))}
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-950">Publikovat do firemního Outlook kalendáře</span>
                <span className="mt-0.5 block text-xs text-slate-600">
                  {form.item_type === 'phase'
                    ? 'Fáze se do kalendáře neposílají; synchronizovat lze úkol nebo milník.'
                    : 'Událost bude viditelná ve firemním kalendáři EKV Plánování. Finanční údaje se nepřenášejí.'}
                </span>
              </span>
            </label>
            {form.id && form.member_id && (
              <div className="flex flex-wrap items-center gap-2 border-t border-blue-100 pt-2">
                <Button type="button" size="sm" variant="outline" disabled={saving || availability?.checking || availabilityDirty} onClick={() => onCheckAvailability(form.id)}>
                  <CalendarDays className="mr-2 h-4 w-4" />
                  {availability?.checking ? 'Kontroluji…' : 'Ověřit dostupnost'}
                </Button>
                {personalMailbox && <span className="text-xs text-slate-500">Osobní dostupnost: {personalMailbox}</span>}
                {availabilityDirty && <p className="w-full text-xs text-amber-800" role="status">Termín nebo řešitel byl změněn. Nejdříve položku uložte, poté ověřte dostupnost uloženého termínu.</p>}
                {!availabilityDirty && availability?.result && (
                  <Badge variant={availability.result.available ? 'success' : 'destructive'}>
                    {availability.result.available ? 'Termín je volný' : `${availability.result.conflicts?.length || 0} kolizí`}
                  </Badge>
                )}
                {!availabilityDirty && availability?.error && <span className="text-xs text-red-700">{availability.error}</span>}
              </div>
            )}
            {calendarLink && (
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className={`h-2 w-2 rounded-full ${calendarLink.sync_status === 'synced' ? 'bg-emerald-500' : calendarLink.sync_status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
                {CALENDAR_STATUS[calendarLink.sync_status] || calendarLink.sync_status}
                {calendarLink.last_error ? `: ${calendarLink.last_error}` : ''}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label>Nadřazená fáze</Label>
            <Select value={form.parent_id || 'none'} onValueChange={(value) => update('parent_id', value === 'none' ? '' : value)}>
              <SelectTrigger><SelectValue placeholder="Bez nadřazené fáze" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Bez nadřazené fáze</SelectItem>
                {items.filter((item) => item.item_type === 'phase' && item.id !== form.id).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Dokončeno (%)</Label>
            <Input type="number" min="0" max="100" value={Math.round((Number(form.progress) || 0) * 100)} onChange={(event) => update('progress', Number(event.target.value) / 100)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Popis</Label>
            <Textarea rows={4} value={form.description || ''} onChange={(event) => update('description', event.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {form.id && <Button type="button" disabled={saving} variant="destructive" className="sm:mr-auto" onClick={() => onDelete(form.id)}><Trash2 className="mr-2 h-4 w-4" />Smazat</Button>}
          <Button type="button" variant="outline" onClick={onClose}>Zrušit</Button>
          <Button type="button" disabled={saving || !form.name.trim() || !form.start_at || !form.end_at} onClick={() => onSave(form)}>{saving ? 'Ukládám…' : 'Uložit'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const TravelDialog = ({ open, value, items, onClose, onSave, saving }) => {
  const [form, setForm] = useState(emptyTravel());
  useEffect(() => {
    if (open) setForm(value ? {
      ...emptyTravel(),
      ...value,
      item_id: value.item_id || '',
      departure_at: toLocalDateTime(value.departure_at || `${value.travel_date}T07:00`, 7),
      arrival_at: toLocalDateTime(value.arrival_at || `${value.travel_date}T08:00`, 8),
      distance_km: value.distance_m ? value.distance_m / 1000 : '',
    } : emptyTravel());
  }, [open, value]);
  const update = (key, nextValue) => setForm((current) => ({ ...current, [key]: nextValue }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{form.id ? 'Upravit cestu' : 'Naplánovat cestu'}</DialogTitle><DialogDescription>Trasu nyní evidujeme ručně; datový model je připravený na pozdější doplnění Mapy.com API.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label>Navázaná aktivita</Label><Select value={form.item_id || 'none'} onValueChange={(value) => update('item_id', value === 'none' ? '' : value)}><SelectTrigger><SelectValue placeholder="Bez vazby na aktivitu" /></SelectTrigger><SelectContent><SelectItem value="none">Bez vazby na aktivitu</SelectItem>{items.filter((item) => item.item_type !== 'phase').map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Odjezd</Label><Input type="datetime-local" step="900" value={form.departure_at} onChange={(e) => update('departure_at', e.target.value)} /></div>
          <div className="space-y-2"><Label>Příjezd</Label><Input type="datetime-local" step="900" value={form.arrival_at} onChange={(e) => update('arrival_at', e.target.value)} /></div>
          <div className="space-y-2"><Label>Stav</Label><Select value={form.status} onValueChange={(v) => update('status', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TRAVEL_STATUS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Odkud</Label><Input value={form.origin_label} onChange={(e) => update('origin_label', e.target.value)} /></div>
          <div className="space-y-2"><Label>Kam</Label><Input value={form.destination_label} onChange={(e) => update('destination_label', e.target.value)} /></div>
          <div className="space-y-2"><Label>Vzdálenost (km)</Label><Input type="number" min="0" step="0.1" value={form.distance_km} onChange={(e) => update('distance_km', e.target.value)} /></div>
          <div className="space-y-2"><Label>Doba cesty (min)</Label><Input type="number" min="0" value={form.duration_minutes} onChange={(e) => update('duration_minutes', e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.overnight_recommended} onCheckedChange={(v) => update('overnight_recommended', Boolean(v))} />Doporučeno přespání</label>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.overnight_required} onCheckedChange={(v) => update('overnight_required', Boolean(v))} />Přespání je nutné</label>
          <div className="space-y-2 sm:col-span-2"><Label>Poznámka</Label><Textarea rows={3} value={form.notes} onChange={(e) => update('notes', e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Zrušit</Button><Button disabled={saving || !form.origin_label.trim() || !form.destination_label.trim() || !form.departure_at || !form.arrival_at} onClick={() => onSave(form)}>{saving ? 'Ukládám…' : 'Uložit cestu'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const AccommodationDialog = ({ open, value, items, members, onClose, onSave, saving }) => {
  const [form, setForm] = useState(emptyAccommodation());
  useEffect(() => { if (open) setForm(value ? { ...emptyAccommodation(), ...value, item_id: value.item_id || '', guest_ids: value.guest_ids || [] } : emptyAccommodation()); }, [open, value]);
  const update = (key, nextValue) => setForm((current) => ({ ...current, [key]: nextValue }));
  const toggleGuest = (memberId, checked) => setForm((current) => ({
    ...current,
    guest_ids: checked ? [...current.guest_ids, memberId] : current.guest_ids.filter((id) => id !== memberId),
  }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{form.id ? 'Upravit ubytování' : 'Přidat ubytování'}</DialogTitle><DialogDescription>Evidence rezervace, termínu a návaznosti na plán projektu nebo realizace.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label>Navázaná aktivita</Label><Select value={form.item_id || 'none'} onValueChange={(value) => update('item_id', value === 'none' ? '' : value)}><SelectTrigger><SelectValue placeholder="Bez vazby na aktivitu" /></SelectTrigger><SelectContent><SelectItem value="none">Bez vazby na aktivitu</SelectItem>{items.filter((item) => item.item_type !== 'phase').map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2 sm:col-span-2"><Label>Ubytování</Label><Input value={form.hotel_name} onChange={(e) => update('hotel_name', e.target.value)} placeholder="Název hotelu nebo ubytování" /></div>
          <div className="space-y-2 sm:col-span-2"><Label>Adresa</Label><Input value={form.address} onChange={(e) => update('address', e.target.value)} /></div>
          <div className="space-y-2"><Label>Příjezd</Label><Input type="date" value={form.check_in} onChange={(e) => update('check_in', e.target.value)} /></div>
          <div className="space-y-2"><Label>Odjezd</Label><Input type="date" value={form.check_out} onChange={(e) => update('check_out', e.target.value)} /></div>
          <div className="space-y-2"><Label>Stav</Label><Select value={form.status} onValueChange={(v) => update('status', v)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ACCOMMODATION_STATUS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Číslo rezervace</Label><Input value={form.booking_reference} onChange={(e) => update('booking_reference', e.target.value)} /></div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Ubytované osoby</Label>
            <div className="grid max-h-40 gap-2 overflow-y-auto rounded-md border bg-slate-50 p-3 sm:grid-cols-2">
              {members.map((member) => <label key={member.id} className="flex items-center gap-2 text-sm"><Checkbox checked={form.guest_ids.includes(member.id)} onCheckedChange={(checked) => toggleGuest(member.id, Boolean(checked))} /><span className="truncate">{member.name || member.email}</span></label>)}
              {!members.length && <span className="text-sm text-slate-500">Pro tento plán nejsou dostupné žádné osoby.</span>}
            </div>
          </div>
          <div className="space-y-2 sm:col-span-2"><Label>Poznámka</Label><Textarea rows={3} value={form.notes} onChange={(e) => update('notes', e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>Zrušit</Button><Button disabled={saving || !form.hotel_name.trim() || !form.check_in || !form.check_out} onClick={() => onSave(form)}>{saving ? 'Ukládám…' : 'Uložit ubytování'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const PlanningBoard = ({ entityType, entityId, embedded = false, canEdit: canEditOverride }) => {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const focusedItemId = new URLSearchParams(location.search).get('planItem');
  const clearFocusedItem = () => {
    const params = new URLSearchParams(location.search);
    params.delete('planItem');
    navigate({pathname:location.pathname, search:params.toString(), hash:location.hash}, {replace:true, state:location.state});
  };
  const [plans, setPlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [data, setData] = useState({ items: [], dependencies: [], travel: [], accommodations: [], members: [], subcontractors: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [scale, setScale] = useState('week');
  const [itemDialog, setItemDialog] = useState({ open: false, value: null });
  const [availability, setAvailability] = useState({ checking: false, result: null, error: '' });
  const [travelDialog, setTravelDialog] = useState({ open: false, value: null });
  const [accommodationDialog, setAccommodationDialog] = useState({ open: false, value: null });
  const [pendingDelete, setPendingDelete] = useState(null);
  const availabilityRequestId = useRef(0);
  const invalidateAvailability = useCallback(() => {
    availabilityRequestId.current += 1;
    setAvailability({ checking: false, result: null, error: '' });
  }, []);

  const focusedItem = data.items.find(item => item.id === focusedItemId);
  const selectedPlan = plans.find((plan) => plan.plan_id === selectedPlanId);
  const permissionEntityType = selectedPlan?.entity_type || entityType;
  const canEdit = canEditOverride ?? (permissionEntityType === 'realization'
    ? hasPermission('realizace', 'can_edit')
    : hasPermission('projects', 'can_edit'));

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (entityType && entityId) {
        const plan = await ensurePlanningPlan(entityType, entityId, { createIfMissing: canEdit });
        setPlans(plan ? [plan] : []);
        setSelectedPlanId(plan?.plan_id || '');
      } else {
        const availablePlans = await listPlanningPlans();
        setPlans(availablePlans || []);
        setSelectedPlanId((current) => current || availablePlans?.[0]?.plan_id || '');
      }
    } catch (loadError) {
      setError(loadError.message);
      toast({ title: 'Plánování se nepodařilo načíst', description: loadError.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [canEdit, entityId, entityType, toast]);

  const loadData = useCallback(async () => {
    if (!selectedPlanId) return;
    setLoading(true);
    try {
      setData(await loadPlanningData(selectedPlanId));
    } catch (loadError) {
      setError(loadError.message);
      toast({ title: 'Data plánu se nepodařilo načíst', description: loadError.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [selectedPlanId, toast]);

  useEffect(() => { loadPlans(); }, [loadPlans]);
  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    invalidateAvailability();
  }, [itemDialog.open, itemDialog.value?.id, invalidateAvailability]);

  const stats = useMemo(() => {
    const activeItems = data.items.filter((item) => !['done', 'cancelled'].includes(item.status));
    return {
      active: activeItems.length,
      milestones: data.items.filter((item) => item.item_type === 'milestone').length,
      late: activeItems.filter((item) => item.end_date < TODAY()).length,
      travelKm: Math.round(data.travel.reduce((sum, segment) => sum + (Number(segment.distance_m) || 0), 0) / 1000),
      nights: data.accommodations.reduce((sum, stay) => sum + Math.max(0, Math.round((parseISO(stay.check_out) - parseISO(stay.check_in)) / 86400000)), 0),
      calendarSynced: data.items.filter((item) => getCalendarLink(item)?.sync_status === 'synced').length,
      calendarErrors: data.items.filter((item) => getCalendarLink(item)?.sync_status === 'error').length,
    };
  }, [data]);

  const runMutation = useCallback(async (operation, successMessage) => {
    setSaving(true);
    try {
      await operation();
      await loadData();
      toast({ title: successMessage });
      return true;
    } catch (mutationError) {
      toast({ title: 'Změnu se nepodařilo uložit', description: mutationError.message, variant: 'destructive' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [loadData, toast]);

  const syncCalendarBestEffort = useCallback(async (itemId) => {
    try {
      return await syncPlanningItemCalendar(itemId);
    } catch (calendarError) {
      toast({
        title: 'Plán je uložen, Outlook čeká na synchronizaci',
        description: calendarError.message,
        variant: 'destructive',
      });
      return null;
    }
  }, [toast]);

  const handleAvailabilityCheck = useCallback(async (itemId) => {
    const requestId = ++availabilityRequestId.current;
    setAvailability({ checking: true, result: null, error: '' });
    try {
      const result = await checkPlanningItemAvailability(itemId);
      if (requestId !== availabilityRequestId.current) return;
      setAvailability({ checking: false, result, error: '' });
      toast({
        title: result.available ? 'Termín je v Outlooku volný' : 'Outlook hlásí kolizi',
        description: result.available
          ? 'V kalendáři přiřazeného pracovníka není v tomto termínu blokující událost.'
          : `Nalezeno kolizí: ${result.conflicts?.length || 0}.`,
        variant: result.available ? 'default' : 'destructive',
      });
    } catch (availabilityError) {
      if (requestId !== availabilityRequestId.current) return;
      setAvailability({ checking: false, result: null, error: availabilityError.message });
      toast({ title: 'Dostupnost se nepodařilo ověřit', description: availabilityError.message, variant: 'destructive' });
    }
  }, [toast]);

  const handleItemSave = async (item) => {
    if (item.item_type !== 'milestone' && new Date(item.end_at) < new Date(item.start_at)) {
      toast({ title: 'Konec nesmí být před začátkem', variant: 'destructive' });
      return;
    }
    const done = await runMutation(async () => {
      const savedItem = await savePlanningItem(selectedPlanId, item);
      if (savedItem.calendar_sync_enabled || getCalendarLink(item)?.external_event_id) {
        await syncCalendarBestEffort(savedItem.id);
      }
    }, 'Položka plánu byla uložena');
    if (done) { setItemDialog({ open: false, value: null }); invalidateAvailability(); }
  };

  const handleItemDelete = async (id) => {
    const done = await runMutation(async () => {
      for (const currentItem of planningDeletionItems(data.items, id)) {
        if (getCalendarLink(currentItem)?.external_event_id) {
          await savePlanningItem(selectedPlanId, { ...currentItem, calendar_sync_enabled: false });
          // Keep records retryable if removal of any parent/child event fails.
          await syncPlanningItemCalendar(currentItem.id);
        }
      }
      await deletePlanningItem(id);
    }, 'Položka plánu byla smazána');
    if (done) setItemDialog({ open: false, value: null });
    return done;
  };

  const requestItemDelete = (id) => {
    const item = data.items.find(entry => entry.id === id);
    const affectedCount = planningDeletionItems(data.items, id).length;
    setPendingDelete({
      title: `Smazat ${item?.item_type === 'phase' ? 'fázi' : 'položku'} „${item?.name || ''}“?`,
      description: `Počet odstraňovaných položek včetně podřízených: ${affectedCount}. Smažou se jejich návaznosti, přiřazení a propojené projektové úkoly. Cesty a ubytování ztratí vazbu na položku. Publikované události budou odstraněny z Outlooku.`,
      perform: () => handleItemDelete(id),
    });
  };

  const handleItemDatesChange = useCallback((id, values) => runMutation(
    async () => {
      const updated = await updatePlanningItemDates(id, values);
      if (updated.calendar_sync_enabled) await syncCalendarBestEffort(id);
    },
    'Termín byl aktualizován',
  ), [runMutation, syncCalendarBestEffort]);

  const handleCalendarSync = useCallback((id) => runMutation(
    () => syncPlanningItemCalendar(id),
    'Firemní Outlook kalendář byl synchronizován',
  ), [runMutation]);

  const handlePlanCalendarSync = useCallback(() => runMutation(
    async () => {
      const results = await syncPlanningPlanCalendar(data.items);
      const failed = results.filter((result) => !result.success);
      if (failed.length) {
        throw new Error(`${failed.length} z ${results.length} událostí se nepodařilo synchronizovat.`);
      }
    },
    'Celý plán byl publikován do firemního kalendáře',
  ), [data.items, runMutation]);

  const handleDependencyCreate = useCallback((dependency) => runMutation(
    () => savePlanningDependency(selectedPlanId, dependency),
    'Návaznost byla vytvořena',
  ), [runMutation, selectedPlanId]);

  const handleDependencyDelete = useCallback((id) => {
    setPendingDelete({ title: 'Odstranit návaznost úkolů?', description: 'Zruší se časová vazba mezi těmito položkami. Samotné úkoly zůstanou zachované.', perform: () => runMutation(() => deletePlanningDependency(id), 'Návaznost byla odstraněna') });
  }, [runMutation]);

  const handleTravelSave = async (segment) => {
    if (new Date(segment.arrival_at) < new Date(segment.departure_at)) {
      toast({ title: 'Příjezd nesmí být před odjezdem', variant: 'destructive' });
      return;
    }
    const done = await runMutation(() => saveTravelSegment(selectedPlanId, segment), 'Cesta byla uložena');
    if (done) setTravelDialog({ open: false, value: null });
  };

  const handleAccommodationSave = async (stay) => {
    if (stay.check_out <= stay.check_in) {
      toast({ title: 'Odjezd musí být po příjezdu', variant: 'destructive' });
      return;
    }
    const done = await runMutation(() => saveAccommodation(selectedPlanId, stay), 'Ubytování bylo uloženo');
    if (done) setAccommodationDialog({ open: false, value: null });
  };

  if (error && !plans.length) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 rounded-md border border-red-200 bg-red-50 p-8 text-center">
        <AlertCircle className="h-9 w-9 text-red-600" />
        <div><div className="font-semibold text-red-950">Plánovací modul zatím není dostupný</div><div className="mt-1 text-sm text-red-700">{error}</div></div>
        <Button variant="outline" onClick={loadPlans}><RefreshCw className="mr-2 h-4 w-4" />Zkusit znovu</Button>
      </div>
    );
  }

  return (
    <div className={embedded ? 'space-y-4' : 'min-w-0 space-y-5'}>
      {!embedded && (
        <PageHeader
          icon={GanttChart}
          title="Plánovací board"
          description="Společný portfolio přehled projekce a realizací. Jednotlivé harmonogramy a oprávnění zůstávají oddělené."
          actions={<Button variant="outline" onClick={() => { loadPlans(); loadData(); }} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Obnovit</Button>}
        />
      )}

      <div className={embedded ? '' : 'px-4 pb-6 sm:px-5'}>
        <div className="mb-4 flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase text-slate-500">Aktivní harmonogram</div>
            {entityType ? (
              <div className="truncate font-semibold text-slate-950">{selectedPlan?.title || 'Načítám plán…'}</div>
            ) : (
              <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                <SelectTrigger className="mt-1 w-full min-w-[280px] lg:w-[520px]"><SelectValue placeholder="Vyberte projekt nebo realizaci" /></SelectTrigger>
                <SelectContent>{plans.map((plan) => <SelectItem key={plan.plan_id} value={plan.plan_id}>{plan.code} · {plan.title}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={scale} onValueChange={setScale}><SelectTrigger className="w-[145px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="day">Detail dne</SelectItem><SelectItem value="week">Týdny</SelectItem><SelectItem value="month">Měsíce</SelectItem></SelectContent></Select>
            {canEdit && <Button onClick={() => setItemDialog({ open: true, value: null })}><Plus className="mr-2 h-4 w-4" />Přidat do plánu</Button>}
          </div>
        </div>

        {focusedItemId && <section aria-label="Vybraný úkol" className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-blue-700">Úkol z přehledu</p>
              {loading ? <p role="status" className="mt-1 text-sm">Načítám vybraný úkol…</p> : focusedItem ? <>
                <h2 className="mt-1 break-words font-semibold text-slate-900">{focusedItem.name}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm"><StatusBadge value={focusedItem.status}/><span>Termín: {formatDate(focusedItem.end_date)}</span></div>
                {focusedItem.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{focusedItem.description}</p>}
              </> : <p role="status" className="mt-1 text-sm">Úkol není v tomto plánu dostupný. Mohl být odebrán nebo k němu nemáte přístup.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {!loading && focusedItem && canEdit && <Button variant="outline" onClick={() => setItemDialog({open:true,value:focusedItem})}><Pencil className="mr-2 h-4 w-4"/>Upravit vybraný úkol</Button>}
              <Button variant="ghost" onClick={clearFocusedItem}>Zrušit výběr úkolu</Button>
            </div>
          </div>
        </section>}

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric icon={Clock3} label="Aktivní položky" value={stats.active} />
          <Metric icon={Milestone} label="Milníky" value={stats.milestones} tone="green" />
          <Metric icon={AlertCircle} label="Po termínu" value={stats.late} tone={stats.late ? 'red' : 'green'} />
          <Metric icon={Route} label="Plánované km" value={`${stats.travelKm} km`} tone="amber" />
          <Metric icon={BedDouble} label="Noclehy" value={stats.nights} />
          <Metric
            icon={CalendarDays}
            label="Outlook"
            value={stats.calendarErrors ? `${stats.calendarErrors} chyb` : `${stats.calendarSynced} sync`}
            tone={stats.calendarErrors ? 'red' : 'green'}
          />
        </div>

        <Tabs defaultValue="gantt" className="min-w-0">
          <TabsList className="mb-3 grid h-auto w-full grid-cols-2 rounded-md bg-slate-100 p-1 sm:grid-cols-4 lg:w-[820px]">
            <TabsTrigger value="gantt"><GanttChart className="mr-2 h-4 w-4" />Gantt</TabsTrigger>
            <TabsTrigger value="milestones"><Flag className="mr-2 h-4 w-4" />Milníky</TabsTrigger>
            <TabsTrigger value="logistics"><Route className="mr-2 h-4 w-4" />Cesty a ubytování</TabsTrigger>
            <TabsTrigger value="calendar"><CalendarDays className="mr-2 h-4 w-4" />Outlook</TabsTrigger>
          </TabsList>
          <TabsContent value="gantt" className="mt-0 min-w-0">
            {loading ? <div className="flex h-[420px] items-center justify-center rounded-md border bg-white text-sm text-slate-500"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Načítám harmonogram…</div> : (
              <Suspense fallback={<div className="flex h-[420px] items-center justify-center rounded-md border bg-white text-sm text-slate-500"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Načítám časovou osu…</div>}>
                <PlanningGantt
                  items={data.items}
                  dependencies={data.dependencies}
                  canEdit={canEdit}
                  scale={scale}
                  onItemEdit={(item) => setItemDialog({ open: true, value: item })}
                  onItemDatesChange={handleItemDatesChange}
                  onDependencyCreate={handleDependencyCreate}
                  onDependencyDelete={handleDependencyDelete}
                />
              </Suspense>
            )}
          </TabsContent>
          <TabsContent value="milestones" className="mt-0">
            <div className="overflow-hidden rounded-md border bg-white">
              <Table>
                <TableHeader><TableRow><TableHead>Milník</TableHead><TableHead>Datum</TableHead><TableHead>Stav</TableHead><TableHead>Odpovědná osoba</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
                <TableBody>
                  {data.items.filter((item) => item.item_type === 'milestone').map((item) => (
                    <TableRow key={item.id}><TableCell className="font-medium">{item.name}</TableCell><TableCell>{item.start_at ? formatDateTime(item.start_at) : formatDate(item.start_date)}</TableCell><TableCell><StatusBadge value={item.status} /></TableCell><TableCell>{item.assignments?.map((assignment) => assignment.member?.name).filter(Boolean).join(', ') || item.member?.name || 'Nepřiřazeno'}</TableCell><TableCell>{canEdit && <Button variant="ghost" size="icon" onClick={() => setItemDialog({ open: true, value: item })}><Pencil className="h-4 w-4" /></Button>}</TableCell></TableRow>
                  ))}
                  {!data.items.some((item) => item.item_type === 'milestone') && <TableRow><TableCell colSpan={5} className="h-28 text-center text-slate-500">Zatím nejsou naplánované žádné milníky.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="logistics" className="mt-0 space-y-4">
            <section className="overflow-hidden rounded-md border bg-white">
              <div className="flex items-center justify-between border-b px-4 py-3"><div><h3 className="font-semibold">Cesty</h3><p className="text-xs text-slate-500">Trasy, vzdálenosti a potřeba přespání.</p></div>{canEdit && <Button size="sm" onClick={() => setTravelDialog({ open: true, value: null })}><Plus className="mr-2 h-4 w-4" />Cesta</Button>}</div>
              <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Čas</TableHead><TableHead>Aktivita</TableHead><TableHead>Trasa</TableHead><TableHead>Vzdálenost</TableHead><TableHead>Doba</TableHead><TableHead>Přespání</TableHead><TableHead>Stav</TableHead><TableHead className="w-20" /></TableRow></TableHeader><TableBody>
                {data.travel.map((segment) => <TableRow key={segment.id}><TableCell className="whitespace-nowrap">{segment.departure_at ? formatDateTime(segment.departure_at) : formatDate(segment.travel_date)}{segment.arrival_at ? <div className="text-xs text-slate-500">do {formatDateTime(segment.arrival_at)}</div> : null}</TableCell><TableCell className="min-w-[180px]">{data.items.find((item) => item.id === segment.item_id)?.name || 'Bez vazby'}</TableCell><TableCell className="min-w-[260px]"><div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-slate-400" />{segment.origin_label} → {segment.destination_label}</div></TableCell><TableCell>{segment.distance_m ? `${(segment.distance_m / 1000).toLocaleString('cs-CZ')} km` : '—'}</TableCell><TableCell>{segment.duration_minutes ? `${segment.duration_minutes} min` : '—'}</TableCell><TableCell>{segment.overnight_required ? 'Nutné' : segment.overnight_recommended ? 'Doporučeno' : 'Ne'}</TableCell><TableCell><StatusBadge value={segment.status} labels={TRAVEL_STATUS} /></TableCell><TableCell>{canEdit && <div className="flex"><Button variant="ghost" size="icon" onClick={() => setTravelDialog({ open: true, value: segment })}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label={`Smazat cestu ${segment.origin_label} – ${segment.destination_label}`} onClick={() => setPendingDelete({ title: 'Smazat naplánovanou cestu?', description: `${segment.origin_label} → ${segment.destination_label}. Smažou se údaje této cesty; navázaná položka plánu zůstane zachovaná.`, perform: () => runMutation(() => deleteTravelSegment(segment.id), 'Cesta byla smazána') })}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>}</TableCell></TableRow>)}
                {!data.travel.length && <TableRow><TableCell colSpan={8} className="h-24 text-center text-slate-500">Zatím nejsou naplánované žádné cesty.</TableCell></TableRow>}
              </TableBody></Table></div>
            </section>
            <section className="overflow-hidden rounded-md border bg-white">
              <div className="flex items-center justify-between border-b px-4 py-3"><div><h3 className="font-semibold">Ubytování</h3><p className="text-xs text-slate-500">Návrhy a potvrzené rezervace navázané na harmonogram.</p></div>{canEdit && <Button size="sm" onClick={() => setAccommodationDialog({ open: true, value: null })}><Plus className="mr-2 h-4 w-4" />Ubytování</Button>}</div>
              <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Ubytování</TableHead><TableHead>Aktivita</TableHead><TableHead>Osoby</TableHead><TableHead>Příjezd</TableHead><TableHead>Odjezd</TableHead><TableHead>Rezervace</TableHead><TableHead>Stav</TableHead><TableHead className="w-20" /></TableRow></TableHeader><TableBody>
                {data.accommodations.map((stay) => <TableRow key={stay.id}><TableCell><div className="font-medium">{stay.hotel_name}</div><div className="text-xs text-slate-500">{stay.address || 'Bez adresy'}</div></TableCell><TableCell className="min-w-[180px]">{data.items.find((item) => item.id === stay.item_id)?.name || 'Bez vazby'}</TableCell><TableCell className="min-w-[180px]">{stay.guest_members?.map((member) => member.name || member.email).join(', ') || 'Nevybráno'}</TableCell><TableCell>{formatDate(stay.check_in)}</TableCell><TableCell>{formatDate(stay.check_out)}</TableCell><TableCell>{stay.booking_reference || '—'}</TableCell><TableCell><StatusBadge value={stay.status} labels={ACCOMMODATION_STATUS} /></TableCell><TableCell>{canEdit && <div className="flex"><Button variant="ghost" size="icon" onClick={() => setAccommodationDialog({ open: true, value: stay })}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label={`Smazat ubytování ${stay.hotel_name}`} onClick={() => setPendingDelete({ title: `Smazat ubytování ${stay.hotel_name}?`, description: 'Smaže se evidence ubytování v portálu. Rezervaci u hotelu tato akce neruší.', perform: () => runMutation(() => deleteAccommodation(stay.id), 'Ubytování bylo smazáno') })}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>}</TableCell></TableRow>)}
                {!data.accommodations.length && <TableRow><TableCell colSpan={8} className="h-24 text-center text-slate-500">Zatím není evidované žádné ubytování.</TableCell></TableRow>}
              </TableBody></Table></div>
            </section>
          </TabsContent>
          <TabsContent value="calendar" className="mt-0">
            <section className="overflow-hidden rounded-md border bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                <div>
                  <h3 className="font-semibold">Firemní Microsoft 365 kalendář</h3>
                  <p className="text-xs text-slate-500">EKVPortal je zdroj termínů. Události jsou publikované do sdíleného kalendáře celé firmy bez finančních údajů.</p>
                </div>
                {canEdit && (
                  <Button size="sm" variant="outline" disabled={saving || !data.items.some((item) => item.calendar_sync_enabled)} onClick={handlePlanCalendarSync}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${saving ? 'animate-spin' : ''}`} />
                    Synchronizovat celý plán
                  </Button>
                )}
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Aktivita</TableHead><TableHead>Termín</TableHead><TableHead>Řešitel</TableHead><TableHead>Firemní kalendář</TableHead><TableHead>Synchronizace</TableHead><TableHead>Poslední změna</TableHead><TableHead className="w-36">Akce</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.items.filter((item) => item.item_type !== 'phase').map((item) => {
                      const link = getCalendarLink(item);
                      return (
                        <TableRow key={item.id}>
                          <TableCell><div className="font-medium">{item.name}</div><div className="text-xs text-slate-500">{ITEM_TYPE[item.item_type]}</div></TableCell>
                          <TableCell className="whitespace-nowrap">{item.start_at ? formatDateTime(item.start_at) : formatDate(item.start_date)}{item.item_type !== 'milestone' ? ` – ${item.end_at ? formatDateTime(item.end_at) : formatDate(item.end_date)}` : ''}</TableCell>
                          <TableCell><div>{item.member?.name || 'Nepřiřazeno'}</div><div className="text-xs text-slate-500">{item.member?.microsoft_calendar_email || item.member?.email || 'Bez e-mailu'}</div></TableCell>
                          <TableCell><div className="font-medium">EKV Plánování</div><div className="text-xs text-slate-500">{link?.mailbox_address || 'Nastaví administrátor'}</div></TableCell>
                          <TableCell>
                            <Badge variant={link?.sync_status === 'synced' ? 'success' : link?.sync_status === 'error' ? 'destructive' : 'secondary'}>
                              {item.calendar_sync_enabled ? CALENDAR_STATUS[link?.sync_status || 'pending'] : 'Vypnuto'}
                            </Badge>
                            {link?.last_error && <div className="mt-1 max-w-[280px] text-xs text-red-700">{link.last_error}</div>}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-slate-600">{link?.last_synced_at ? format(parseISO(link.last_synced_at), 'd. M. yyyy HH:mm', { locale: cs }) : '—'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {item.member_id && <Button variant="ghost" size="icon" title="Ověřit dostupnost" onClick={() => handleAvailabilityCheck(item.id)}><CheckCircle2 className="h-4 w-4" /></Button>}
                              {canEdit && item.calendar_sync_enabled && <Button variant="ghost" size="icon" title="Synchronizovat" disabled={saving} onClick={() => handleCalendarSync(item.id)}><RefreshCw className="h-4 w-4" /></Button>}
                              {link?.web_link && <Button asChild variant="ghost" size="icon" title="Otevřít v Outlooku"><a href={link.web_link} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>}
                              {canEdit && <Button variant="ghost" size="icon" title="Upravit aktivitu" onClick={() => setItemDialog({ open: true, value: item })}><Pencil className="h-4 w-4" /></Button>}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!data.items.some((item) => item.item_type !== 'phase') && <TableRow><TableCell colSpan={7} className="h-28 text-center text-slate-500">Nejdříve přidejte úkol nebo milník.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>

      <ItemDialog open={itemDialog.open} value={itemDialog.value} items={data.items} members={data.members} subcontractors={data.subcontractors} availability={availability} saving={saving} onCheckAvailability={handleAvailabilityCheck} onClose={() => setItemDialog({ open: false, value: null })} onSave={handleItemSave} onDelete={requestItemDelete} onAvailabilityInvalidate={invalidateAvailability} />
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => { if (!open && !saving) { setPendingDelete(null); setData(current => ({ ...current, dependencies: [...current.dependencies] })); } }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{pendingDelete?.title}</AlertDialogTitle><AlertDialogDescription>{pendingDelete?.description}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Ponechat</AlertDialogCancel>
            <AlertDialogAction disabled={saving} className="bg-destructive hover:bg-destructive/90" onClick={async event => { event.preventDefault(); if (await pendingDelete?.perform()) setPendingDelete(null); }}>{saving ? 'Mažu…' : 'Smazat'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <TravelDialog open={travelDialog.open} value={travelDialog.value} items={data.items} saving={saving} onClose={() => setTravelDialog({ open: false, value: null })} onSave={handleTravelSave} />
      <AccommodationDialog open={accommodationDialog.open} value={accommodationDialog.value} items={data.items} members={data.members} saving={saving} onClose={() => setAccommodationDialog({ open: false, value: null })} onSave={handleAccommodationSave} />
    </div>
  );
};

export default PlanningBoard;
