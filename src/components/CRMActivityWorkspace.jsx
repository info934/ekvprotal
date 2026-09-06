import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, CheckCircle2, Clock3, ExternalLink, Mail, MapPin, Pencil, Phone, Plus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { buildCrmAttendees } from '@/lib/crmActivity';
import { cn } from '@/lib/utils';

const ACTIVITY_TYPES = [
  { value: 'meeting', label: 'Schůzka', icon: Users },
  { value: 'call', label: 'Telefonát', icon: Phone },
  { value: 'email', label: 'E-mail', icon: Mail },
  { value: 'task', label: 'Úkol', icon: CheckCircle2 },
  { value: 'note', label: 'Poznámka', icon: Pencil },
];

const STATUS_LABELS = {
  planned: 'Naplánováno',
  in_progress: 'Probíhá',
  completed: 'Dokončeno',
  cancelled: 'Zrušeno',
};

const toLocalInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const defaultStart = () => {
  const date = new Date();
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(date);
};

const emptyDraft = (opportunity, memberId) => {
  const start = defaultStart();
  return {
    id: null,
    type: 'meeting',
    status: 'planned',
    title: '',
    description: '',
    starts_at: start,
    ends_at: toLocalInput(new Date(new Date(start).getTime() + 60 * 60_000)),
    location: '',
    attendee_emails: opportunity?.subject?.email || '',
    assigned_member_id: opportunity?.owner_member_id || memberId || '',
    outcome: '',
    meeting_minutes: '',
    next_step: '',
    calendar_sync_enabled: true,
  };
};

const formatWhen = (value) => value
  ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Bez termínu';

const CRMActivityWorkspace = ({ opportunity, activities = [], canEdit, onChanged }) => {
  const { memberId } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraft(opportunity, memberId));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.from('members').select('id, name, email, microsoft_calendar_email, microsoft_calendar_enabled')
      .order('name')
      .then(({ data, error }) => {
        if (!active) return;
        if (error) console.error('CRM members failed to load', error);
        setMembers(data || []);
      });
    return () => { active = false; };
  }, []);

  const sortedActivities = useMemo(() => [...activities].sort((a, b) => {
    const left = new Date(a.starts_at || a.due_at || a.created_at || 0).getTime();
    const right = new Date(b.starts_at || b.due_at || b.created_at || 0).getTime();
    return right - left;
  }), [activities]);

  const openNew = useCallback(() => {
    setDraft(emptyDraft(opportunity, memberId));
    setDialogOpen(true);
  }, [memberId, opportunity]);

  const openEdit = (activity) => {
    setDraft({
      ...emptyDraft(opportunity, memberId),
      ...activity,
      starts_at: toLocalInput(activity.starts_at || activity.due_at),
      ends_at: toLocalInput(activity.ends_at),
      attendee_emails: (activity.attendees || []).map((entry) => entry.email || entry.address || '').filter(Boolean).join(', '),
    });
    setDialogOpen(true);
  };

  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  const saveActivity = async (event) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    if (draft.ends_at && draft.starts_at && new Date(draft.ends_at) <= new Date(draft.starts_at)) {
      toast({ title: 'Konec musí být po začátku aktivity', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const startsAt = draft.starts_at ? new Date(draft.starts_at).toISOString() : null;
      const payload = {
        opportunity_id: opportunity.id,
        subject_id: opportunity.subject_id || opportunity.subject?.id || null,
        project_id: opportunity.project_id || opportunity.project?.id || null,
        assigned_member_id: draft.assigned_member_id || null,
        created_by_member_id: draft.created_by_member_id || memberId || null,
        type: draft.type,
        status: draft.status,
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        starts_at: startsAt,
        ends_at: draft.ends_at ? new Date(draft.ends_at).toISOString() : null,
        due_at: startsAt,
        completed_at: draft.status === 'completed' ? (draft.completed_at || new Date().toISOString()) : null,
        location: draft.location.trim() || null,
        attendees: buildCrmAttendees(draft.attendee_emails),
        outcome: draft.outcome.trim() || null,
        meeting_minutes: draft.meeting_minutes.trim() || null,
        next_step: draft.next_step.trim() || null,
        calendar_sync_enabled: draft.type === 'meeting' && Boolean(draft.calendar_sync_enabled),
      };
      const query = draft.id
        ? supabase.from('crm_activities').update(payload).eq('id', draft.id).select('id').single()
        : supabase.from('crm_activities').insert(payload).select('id').single();
      const { data, error } = await query;
      if (error) throw error;

      if (payload.calendar_sync_enabled) {
        const { error: syncError } = await supabase.functions.invoke('crm-activity-calendar', {
          body: { action: 'sync', activityId: data.id },
        });
        if (syncError) {
          toast({
            title: 'Aktivita je uložená, pozvánku se nepodařilo synchronizovat',
            description: syncError.message,
            variant: 'destructive',
          });
        } else {
          toast({ title: draft.id ? 'Aktivita a pozvánka byly aktualizovány' : 'Aktivita byla vytvořena a pozvánka odeslána' });
        }
      } else if (draft.id && draft.external_event_id) {
        const { error: deleteSyncError } = await supabase.functions.invoke('crm-activity-calendar', {
          body: { action: 'delete', activityId: data.id },
        });
        if (deleteSyncError) {
          toast({ title: 'Aktivita je uložená, starou událost se nepodařilo odstranit', description: deleteSyncError.message, variant: 'destructive' });
        } else {
          toast({ title: 'Aktivita byla aktualizována a událost odstraněna z kalendáře' });
        }
      } else {
        toast({ title: draft.id ? 'Aktivita byla aktualizována' : 'Aktivita byla vytvořena' });
      }

      setDialogOpen(false);
      await onChanged?.();
    } catch (error) {
      toast({ title: 'Aktivitu se nepodařilo uložit', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const completeActivity = async (activity) => {
    const { error } = await supabase.from('crm_activities').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    }).eq('id', activity.id);
    if (error) {
      toast({ title: 'Aktivitu se nepodařilo dokončit', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Aktivita byla dokončena' });
    await onChanged?.();
  };

  return (
    <div className="space-y-4 rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Aktivity obchodního případu</h3>
          <p className="mt-1 text-xs text-muted-foreground">Telefonáty, schůzky, pozvánky, zápisy a další kroky na jednom místě.</p>
        </div>
        {canEdit && <Button size="sm" onClick={openNew}><Plus className="mr-2 h-4 w-4" />Nová aktivita</Button>}
      </div>

      {sortedActivities.length === 0 ? (
        <button type="button" onClick={canEdit ? openNew : undefined} className="w-full rounded-lg border border-dashed p-6 text-left text-sm text-muted-foreground hover:border-primary/40 hover:bg-primary/5 disabled:cursor-default">
          Zatím není naplánována žádná aktivita. {canEdit && 'Kliknutím naplánujete první kontakt nebo schůzku.'}
        </button>
      ) : (
        <div className="space-y-3">
          {sortedActivities.map((activity) => {
            const config = ACTIVITY_TYPES.find((item) => item.value === activity.type) || ACTIVITY_TYPES[4];
            const Icon = config.icon;
            return (
              <div key={activity.id} className={cn('rounded-lg border p-4', activity.status === 'completed' ? 'bg-emerald-50/40' : 'bg-slate-50')}>
                <div className="flex items-start gap-3">
                  <div className="rounded-md border bg-white p-2 text-primary"><Icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-950">{activity.title}</span>
                      <Badge variant="outline" className="bg-white">{config.label}</Badge>
                      <Badge variant={activity.status === 'completed' ? 'secondary' : 'outline'}>{STATUS_LABELS[activity.status] || activity.status}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatWhen(activity.starts_at || activity.due_at)}</span>
                      {activity.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{activity.location}</span>}
                      {activity.assigned?.name && <span>{activity.assigned.name}</span>}
                    </div>
                    {activity.description && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{activity.description}</p>}
                    {activity.meeting_minutes && <div className="mt-3 rounded-md border bg-white p-3 text-sm"><strong>Zápis:</strong><p className="mt-1 whitespace-pre-wrap text-slate-700">{activity.meeting_minutes}</p></div>}
                    {(activity.outcome || activity.next_step) && <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{activity.outcome && <p><strong>Výsledek:</strong> {activity.outcome}</p>}{activity.next_step && <p><strong>Další krok:</strong> {activity.next_step}</p>}</div>}
                  </div>
                  {canEdit && <div className="flex shrink-0 gap-1">
                    {activity.external_web_link && <Button asChild size="icon" variant="ghost" title="Otevřít v kalendáři"><a href={activity.external_web_link} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>}
                    <Button size="icon" variant="ghost" onClick={() => openEdit(activity)} title="Upravit"><Pencil className="h-4 w-4" /></Button>
                    {activity.status !== 'completed' && <Button size="icon" variant="ghost" onClick={() => completeActivity(activity)} title="Dokončit"><CheckCircle2 className="h-4 w-4" /></Button>}
                  </div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft.id ? 'Upravit aktivitu' : 'Nová obchodní aktivita'}</DialogTitle>
            <DialogDescription>Naplánujte kontakt, přidejte účastníky a po schůzce doplňte zápis a výsledek.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveActivity} className="space-y-5">
            <fieldset disabled={saving} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2"><Label>Typ</Label><Select value={draft.type} onValueChange={(value) => update('type', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ACTIVITY_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Stav</Label><Select value={draft.status} onValueChange={(value) => update('status', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Odpovědná osoba</Label><Select value={draft.assigned_member_id || 'unassigned'} onValueChange={(value) => update('assigned_member_id', value === 'unassigned' ? '' : value)}><SelectTrigger><SelectValue placeholder="Vyberte osobu" /></SelectTrigger><SelectContent><SelectItem value="unassigned">Nepřiřazeno</SelectItem>{members.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="space-y-2"><Label>Název</Label><Input required maxLength={200} value={draft.title} onChange={(event) => update('title', event.target.value)} placeholder="Např. Technická konzultace FVE" /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Začátek</Label><Input type="datetime-local" value={draft.starts_at} onChange={(event) => update('starts_at', event.target.value)} /></div>
                <div className="space-y-2"><Label>Konec</Label><Input type="datetime-local" value={draft.ends_at} onChange={(event) => update('ends_at', event.target.value)} /></div>
              </div>
              <div className="space-y-2"><Label>Místo / online odkaz</Label><Input value={draft.location} onChange={(event) => update('location', event.target.value)} placeholder="Adresa nebo odkaz na online schůzku" /></div>
              <div className="space-y-2"><Label>Popis pro interní tým</Label><Textarea value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="Co je cílem aktivity a co připravit" /></div>
              {draft.type === 'meeting' && <div className="space-y-4 rounded-lg border bg-slate-50 p-4">
                <div className="space-y-2"><Label>E-maily účastníků</Label><Input value={draft.attendee_emails} onChange={(event) => update('attendee_emails', event.target.value)} placeholder="klient@example.cz, kolega@ekvproject.cz" /><p className="text-xs text-muted-foreground">Oddělte čárkou. Pozvánka se odešle přes kalendář při uložení.</p></div>
                <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" checked={draft.calendar_sync_enabled} onChange={(event) => update('calendar_sync_enabled', event.target.checked)} className="h-4 w-4 rounded border-slate-300" /><CalendarPlus className="h-4 w-4 text-primary" />Vytvořit nebo aktualizovat událost v Microsoft 365</label>
              </div>}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Výsledek</Label><Textarea value={draft.outcome} onChange={(event) => update('outcome', event.target.value)} placeholder="Co bylo dohodnuto" /></div>
                <div className="space-y-2"><Label>Další krok</Label><Textarea value={draft.next_step} onChange={(event) => update('next_step', event.target.value)} placeholder="Konkrétní navazující činnost" /></div>
              </div>
              <div className="space-y-2"><Label>Zápis ze schůzky</Label><Textarea className="min-h-[130px]" value={draft.meeting_minutes} onChange={(event) => update('meeting_minutes', event.target.value)} placeholder="Témata, rozhodnutí, závazky a termíny" /></div>
            </fieldset>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Zrušit</Button><Button type="submit" disabled={saving}>{saving ? 'Ukládám…' : 'Uložit aktivitu'}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CRMActivityWorkspace;
