import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Camera, CheckCircle2, ChevronRight, Inbox, Mail, Paperclip, Plus, Search, ShieldCheck, Wrench } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { ensureEntityFolder } from '@/lib/documentStorageService';
import { formatServiceDate, priorityTone, serviceKindLabels, servicePriorityLabels, serviceStatusLabels, serviceTypeLabels, statusTone, warrantyLabels } from '@/lib/serviceModule';

const blankCase = {
  title: '', case_kind: 'complaint', system_type: 'fve', priority: 'normal', warranty_status: 'unknown', source: 'client',
  opportunity_id: '', realizace_id: '', project_id: '', subject_id: '', assigned_member_id: '', client_name: '',
  client_contact_name: '', client_email: '', client_phone: '', installation_address: '', description: '', equipment_summary: '',
  serial_numbers: '', error_code: '', remote_diagnostics: '', scheduled_start: '', scheduled_end: '', response_due_at: '', link_type: 'standalone',
};
const selectClass = 'h-10 w-full rounded-md border border-input bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const Service = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('service', 'can_edit');
  const { toast } = useToast();
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [members, setMembers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [realizations, setRealizations] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('all');
  const [priority, setPriority] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState(blankCase);
  const [sourceTicketId, setSourceTicketId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [caseRes, ticketRes, memberRes, subjectRes, opportunityRes, realizationRes, projectRes] = await Promise.all([
      supabase.from('service_cases').select('*, assigned:assigned_member_id(id,name), subject:subject_id(id,name,email,phone,contact_person,address), project:project_id(id,name,code), realizace:realizace_id(id,name), opportunity:opportunity_id(id,number,title), visits:service_visits(count), attachments:service_attachments(count)').order('reported_at', { ascending: false }),
      supabase.from('service_tickets').select('*, service_case:service_case_id(id,number), attachments:service_ticket_attachments(count)').order('received_at', { ascending: false }).limit(100),
      supabase.from('members').select('id,name').not('auth_user_id', 'is', null).order('name'),
      supabase.from('subjects').select('id,name,email,phone,contact_person,address').order('name'),
      supabase.from('crm_opportunities').select('id,number,title,subject_id,project_id,subject:subject_id(id,name,email,phone,contact_person,address)').is('deleted_at', null).order('created_at', { ascending: false }).limit(500),
      supabase.from('realizations').select('id,name,location_address,investor_id,linked_project_id,crm_opportunity_id').order('created_at', { ascending: false }).limit(500),
      supabase.from('projects').select('id,name,code,location,client_id,investor_id,crm_opportunity_id').order('created_at', { ascending: false }).limit(500),
    ]);
    const error = caseRes.error || ticketRes.error || memberRes.error || subjectRes.error || opportunityRes.error || realizationRes.error || projectRes.error;
    if (error) toast({ title: 'Servis se nepodařilo načíst', description: error.message, variant: 'destructive' });
    setCases(caseRes.data || []); setTickets(ticketRes.data || []); setMembers(memberRes.data || []); setSubjects(subjectRes.data || []);
    setOpportunities(opportunityRes.data || []); setRealizations(realizationRes.data || []); setProjects(projectRes.data || []);
    setLoading(false);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => cases.filter((item) => {
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || [item.number, item.title, item.client_name, item.installation_address, item.error_code].some((value) => String(value || '').toLowerCase().includes(needle));
    const matchesStatus = status === 'all' || (status === 'open' ? !['resolved', 'closed', 'cancelled'].includes(item.status) : item.status === status);
    return matchesQuery && matchesStatus && (type === 'all' || item.system_type === type) && (priority === 'all' || item.priority === priority);
  }), [cases, priority, query, status, type]);

  const stats = useMemo(() => ({
    open: cases.filter((item) => !['resolved', 'closed', 'cancelled'].includes(item.status)).length,
    scheduled: cases.filter((item) => item.status === 'scheduled').length,
    resolved: cases.filter((item) => ['resolved', 'closed'].includes(item.status)).length,
    critical: cases.filter((item) => item.priority === 'critical' && !['resolved', 'closed', 'cancelled'].includes(item.status)).length,
  }), [cases]);

  const applySubject = (subjectId, extra = {}) => {
    const subject = subjects.find((item) => item.id === subjectId);
    setDraft((current) => ({ ...current, subject_id: subjectId || '', client_name: subject?.name || current.client_name, client_contact_name: subject?.contact_person || current.client_contact_name, client_email: subject?.email || current.client_email, client_phone: subject?.phone || current.client_phone, installation_address: extra.installation_address || subject?.address || current.installation_address, ...extra }));
  };
  const chooseLink = (value) => {
    setDraft((current) => ({ ...blankCase, title: current.title, description: current.description, link_type: current.link_type, [current.link_type === 'opportunity' ? 'opportunity_id' : current.link_type === 'realizace' ? 'realizace_id' : 'project_id']: value }));
    if (draft.link_type === 'opportunity') {
      const item = opportunities.find((row) => row.id === value); if (item) applySubject(item.subject_id, { opportunity_id: item.id, project_id: item.project_id || '', title: draft.title || `Servis · ${item.title}` });
    } else if (draft.link_type === 'realizace') {
      const item = realizations.find((row) => row.id === value); if (item) applySubject(item.investor_id, { realizace_id: item.id, project_id: item.linked_project_id || '', opportunity_id: item.crm_opportunity_id || '', installation_address: item.location_address || '', title: draft.title || `Servis · ${item.name}` });
    } else if (draft.link_type === 'project') {
      const item = projects.find((row) => row.id === value); if (item) applySubject(item.client_id || item.investor_id, { project_id: item.id, opportunity_id: item.crm_opportunity_id || '', installation_address: item.location || '', title: draft.title || `Servis · ${item.name}` });
    }
  };
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const openNewCase = () => { setSourceTicketId(''); setDraft(blankCase); setDialogOpen(true); };
  const convertTicket = (ticket) => {
    setSourceTicketId(ticket.id);
    setDraft({
      ...blankCase,
      title: String(ticket.subject || 'Servisní požadavek').slice(0, 200),
      source: 'email',
      subject_id: ticket.suggested_subject_id || '', opportunity_id: ticket.suggested_opportunity_id || '',
      realizace_id: ticket.suggested_realizace_id || '', project_id: ticket.suggested_project_id || '',
      client_name: ticket.sender_name || ticket.sender_email, client_contact_name: ticket.sender_name || '',
      client_email: ticket.sender_email, description: ticket.body_text || ticket.subject,
      link_type: ticket.suggested_realizace_id ? 'realizace' : ticket.suggested_project_id ? 'project' : ticket.suggested_opportunity_id ? 'opportunity' : 'standalone',
    });
    setDialogOpen(true);
  };
  const closeTicket = async (ticket, nextStatus) => {
    const { error } = await supabase.from('service_tickets').update({ status: nextStatus }).eq('id', ticket.id);
    if (error) return toast({ title: 'Ticket se nepodařilo změnit', description: error.message, variant: 'destructive' });
    await load();
  };
  const createCase = async (event) => {
    event.preventDefault(); setSaving(true);
    const { link_type, ...payload } = draft;
    const { data, error } = sourceTicketId
      ? await supabase.rpc('convert_service_ticket', { p_ticket_id: sourceTicketId, p_payload: payload })
      : await supabase.rpc('create_service_case', { p_payload: payload });
    setSaving(false);
    if (error) return toast({ title: 'Případ se nepodařilo vytvořit', description: error.message, variant: 'destructive' });
    try {
      await ensureEntityFolder({ entityType: 'service', entityId: data.id, code: data.number, name: data.title });
      toast({ title: sourceTicketId ? `${data.number} vznikl z e-mailového ticketu` : `${data.number} byl vytvořen`, description: 'Složka servisu a její podsložky jsou připravené v Dokumenty – Realizace.' });
    } catch (storageError) {
      toast({ title: `${data.number} byl vytvořen`, description: `Případ je uložený, složku se nepodařilo připravit: ${storageError.message}`, variant: 'destructive' });
    }
    setDialogOpen(false); setSourceTicketId(''); setDraft(blankCase); navigate(`/service/${data.id}`);
  };

  return <div className="app-page space-y-5">
    <PageHeader icon={Wrench} title="Servis a reklamace" description="Řízení reklamací, servisních výjezdů, fotodokumentace a podepsaných protokolů."
      actions={canEdit && <Button onClick={openNewCase}><Plus className="mr-2 h-4 w-4" />Nový servisní případ</Button>} />
    <Card className="overflow-hidden border-blue-200">
      <div className="flex flex-col gap-3 border-b bg-blue-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3"><span className="rounded-lg bg-blue-100 p-2 text-blue-700"><Inbox className="h-5 w-5" /></span><div><h2 className="font-semibold text-slate-950">Příchozí e-mailové tickety</h2><p className="text-sm text-slate-600">E-maily čekající na kontrolu a převod na servisní případ.</p></div></div>
        <Badge className="w-fit" variant={tickets.some((item) => ['new','triage'].includes(item.status)) ? 'default' : 'outline'}>{tickets.filter((item) => ['new','triage'].includes(item.status)).length} čeká</Badge>
      </div>
      <CardContent className="p-0">
        {tickets.filter((item) => ['new','triage'].includes(item.status)).length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">Ve schránce není žádný nový servisní ticket.</div> : <div className="divide-y">{tickets.filter((item) => ['new','triage'].includes(item.status)).slice(0, 12).map((ticket) => <div key={ticket.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-blue-700">{ticket.number}</span><Badge variant="outline">{ticket.status === 'triage' ? 'K posouzení' : 'Nový e-mail'}</Badge><span className="text-xs text-slate-500">{formatServiceDate(ticket.received_at)}</span></div><h3 className="mt-1 truncate font-semibold text-slate-950">{ticket.subject}</h3><p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-600"><span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{ticket.sender_name || ticket.sender_email}</span>{ticket.attachments?.[0]?.count > 0 && <span className="inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" />{ticket.attachments[0].count} příloh</span>}</p><p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600">{ticket.body_text}</p></div>{canEdit && <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => convertTicket(ticket)}>Vytvořit servisní případ</Button><Button size="sm" variant="outline" onClick={() => closeTicket(ticket, 'closed')}>Uzavřít</Button><Button size="sm" variant="ghost" onClick={() => closeTicket(ticket, 'spam')}>Spam</Button></div>}</div>)}</div>}
      </CardContent>
    </Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[["Otevřené případy", stats.open, Wrench, 'text-blue-700 bg-blue-50'], ["Naplánované výjezdy", stats.scheduled, CalendarClock, 'text-amber-700 bg-amber-50'], ["Vyřešeno", stats.resolved, CheckCircle2, 'text-emerald-700 bg-emerald-50'], ["Kritické", stats.critical, AlertTriangle, 'text-rose-700 bg-rose-50']].map(([label, value, Icon, tone]) => <Card key={label}><CardContent className="flex items-center gap-3 p-4"><span className={`rounded-lg p-2 ${tone}`}><Icon className="h-5 w-5" /></span><div><p className="text-2xl font-semibold text-slate-950">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div></CardContent></Card>)}
    </div>
    <section className="app-surface overflow-hidden">
      <div className="grid gap-3 border-b p-4 md:grid-cols-[minmax(220px,1fr)_180px_170px_170px]">
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input aria-label="Hledat servisní případ" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Číslo, klient, závada…" className="pl-9" /></div>
        <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Otevřené stavy</option><option value="all">Všechny stavy</option>{Object.entries(serviceStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select className={selectClass} value={type} onChange={(e) => setType(e.target.value)}><option value="all">Všechny systémy</option>{Object.entries(serviceTypeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value)}><option value="all">Všechny priority</option>{Object.entries(servicePriorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </div>
      <div className="hidden overflow-x-auto lg:block"><table className="w-full text-sm"><thead><tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><th className="px-4 py-3">Případ / klient</th><th className="px-4 py-3">Systém a vazba</th><th className="px-4 py-3">Stav</th><th className="px-4 py-3">Priorita</th><th className="px-4 py-3">Technik</th><th className="px-4 py-3">Naplánováno</th><th className="px-4 py-3">Dokumentace</th><th /></tr></thead><tbody>
        {filtered.map((item) => <tr key={item.id} className="border-t hover:bg-slate-50"><td className="px-4 py-4"><Link to={`/service/${item.id}`} className="font-semibold text-blue-700 hover:underline">{item.number}</Link><p className="mt-1 font-medium text-slate-950">{item.client_name}</p><p className="max-w-[280px] truncate text-xs text-slate-500">{item.title}</p></td><td className="px-4 py-4"><Badge variant="outline">{serviceTypeLabels[item.system_type]}</Badge><p className="mt-2 text-xs text-blue-700">{item.opportunity?.number || item.realizace?.name || item.project?.code || 'Samostatný případ'}</p></td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(item.status)}`}>{serviceStatusLabels[item.status]}</span></td><td className={`px-4 py-4 font-semibold ${priorityTone(item.priority)}`}>{servicePriorityLabels[item.priority]}</td><td className="px-4 py-4">{item.assigned?.name || 'Nepřiřazeno'}</td><td className="px-4 py-4">{formatServiceDate(item.scheduled_start)}</td><td className="px-4 py-4"><span className="inline-flex items-center gap-1"><Camera className="h-4 w-4" />{item.attachments?.[0]?.count || 0}</span><span className="ml-3 text-slate-500">{item.visits?.[0]?.count || 0} výjezdů</span></td><td className="px-4"><Button asChild size="icon" variant="ghost"><Link to={`/service/${item.id}`} aria-label={`Otevřít ${item.number}`}><ChevronRight className="h-4 w-4" /></Link></Button></td></tr>)}
      </tbody></table></div>
      <div className="divide-y lg:hidden">{filtered.map((item) => <Link key={item.id} to={`/service/${item.id}`} className="block p-4 active:bg-slate-50"><div className="flex items-start justify-between gap-3"><div><span className="text-sm font-semibold text-blue-700">{item.number}</span><h3 className="mt-1 font-semibold text-slate-950">{item.client_name}</h3><p className="mt-1 text-sm text-slate-600">{item.title}</p></div><ChevronRight className="mt-2 h-5 w-5 text-slate-400" /></div><div className="mt-3 flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusTone(item.status)}`}>{serviceStatusLabels[item.status]}</span><Badge variant="outline">{serviceTypeLabels[item.system_type]}</Badge><span className={`text-xs font-semibold ${priorityTone(item.priority)}`}>{servicePriorityLabels[item.priority]}</span></div><p className="mt-3 text-xs text-slate-500">{item.assigned?.name || 'Nepřiřazeno'} · {formatServiceDate(item.scheduled_start)}</p></Link>)}</div>
      {!loading && filtered.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">Žádný servisní případ neodpovídá filtrům.</div>}
      {loading && <div className="p-10 text-center text-sm text-muted-foreground">Načítám servisní případy…</div>}
    </section>

    <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setSourceTicketId(''); }}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{sourceTicketId ? 'Převést ticket na servisní případ' : 'Nový servisní případ'}</DialogTitle><DialogDescription>{sourceTicketId ? 'Zkontrolujte údaje převzaté z e-mailu. Po uložení zůstane původní zpráva i přílohy dohledatelná.' : 'Založte reklamaci nebo servis z existující zakázky, případně jako samostatný případ.'}</DialogDescription></DialogHeader><form onSubmit={createCase} className="space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['standalone','Samostatný'],['opportunity','Z OP'],['realizace','Z realizace'],['project','Z projektu']].map(([key,label]) => <Button key={key} type="button" variant={draft.link_type === key ? 'default' : 'outline'} onClick={() => setDraft({ ...blankCase, link_type:key })}>{label}</Button>)}</div>
      {draft.link_type !== 'standalone' && <div className="space-y-2"><Label>Navázat na {draft.link_type === 'opportunity' ? 'obchodní případ' : draft.link_type === 'realizace' ? 'realizaci' : 'projekt'}</Label><select className={selectClass} value={draft[`${draft.link_type}_id`] || ''} onChange={(e) => chooseLink(e.target.value)} required><option value="">Vyberte záznam</option>{(draft.link_type === 'opportunity' ? opportunities : draft.link_type === 'realizace' ? realizations : projects).map((item) => <option key={item.id} value={item.id}>{item.number || item.code || ''} {item.title || item.name}</option>)}</select></div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div className="space-y-2"><Label>Typ případu</Label><select className={selectClass} value={draft.case_kind} onChange={(e) => update('case_kind', e.target.value)}>{Object.entries(serviceKindLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="space-y-2"><Label>Technologie</Label><select className={selectClass} value={draft.system_type} onChange={(e) => update('system_type', e.target.value)}>{Object.entries(serviceTypeLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="space-y-2"><Label>Priorita</Label><select className={selectClass} value={draft.priority} onChange={(e) => update('priority', e.target.value)}>{Object.entries(servicePriorityLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div><div className="space-y-2"><Label>Záruka</Label><select className={selectClass} value={draft.warranty_status} onChange={(e) => update('warranty_status', e.target.value)}>{Object.entries(warrantyLabels).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div></div>
      <div className="space-y-2"><Label>Název případu</Label><Input required minLength={3} maxLength={200} value={draft.title} onChange={(e) => update('title', e.target.value)} placeholder="Např. BESS hlásí chybu komunikace" /></div>
      {draft.link_type === 'standalone' && <div className="space-y-2"><Label>Klient z adresáře (volitelné)</Label><select className={selectClass} value={draft.subject_id} onChange={(e) => applySubject(e.target.value)}><option value="">Nový / ručně</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Klient</Label><Input required value={draft.client_name} onChange={(e) => update('client_name', e.target.value)} /></div><div className="space-y-2"><Label>Kontaktní osoba</Label><Input value={draft.client_contact_name} onChange={(e) => update('client_contact_name', e.target.value)} /></div><div className="space-y-2"><Label>E-mail</Label><Input type="email" value={draft.client_email} onChange={(e) => update('client_email', e.target.value)} /></div><div className="space-y-2"><Label>Telefon</Label><Input type="tel" value={draft.client_phone} onChange={(e) => update('client_phone', e.target.value)} /></div></div>
      <div className="space-y-2"><Label>Adresa instalace</Label><Input value={draft.installation_address} onChange={(e) => update('installation_address', e.target.value)} /></div>
      <div className="space-y-2"><Label>Popis závady nebo požadavku</Label><Textarea required minLength={3} className="min-h-[110px]" value={draft.description} onChange={(e) => update('description', e.target.value)} /></div>
      <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label>Zařízení / konfigurace</Label><Textarea value={draft.equipment_summary} onChange={(e) => update('equipment_summary', e.target.value)} placeholder="Střídač, baterie, výkon…" /></div><div className="space-y-2"><Label>Sériová čísla</Label><Textarea value={draft.serial_numbers} onChange={(e) => update('serial_numbers', e.target.value)} placeholder="Jedno číslo na řádek" /></div><div className="space-y-2"><Label>Kód chyby</Label><Textarea value={draft.error_code} onChange={(e) => update('error_code', e.target.value)} placeholder="Např. E031, alarm BMS" /></div></div>
      <div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><Label>Přiřazený technik</Label><select className={selectClass} value={draft.assigned_member_id} onChange={(e) => update('assigned_member_id', e.target.value)}><option value="">Nepřiřazeno</option>{members.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="space-y-2"><Label>Plánovaný začátek</Label><Input type="datetime-local" value={draft.scheduled_start} onChange={(e) => update('scheduled_start', e.target.value)} /></div><div className="space-y-2"><Label>Plánovaný konec</Label><Input type="datetime-local" value={draft.scheduled_end} onChange={(e) => update('scheduled_end', e.target.value)} /></div></div>
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900"><ShieldCheck className="mr-2 inline h-4 w-4" />Případ bude auditovaný a fotky i protokoly zůstanou v soukromém úložišti.</div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Zrušit</Button><Button disabled={saving}>{saving ? 'Zakládám…' : sourceTicketId ? 'Vytvořit z ticketu' : 'Založit případ'}</Button></DialogFooter>
    </form></DialogContent></Dialog>
  </div>;
};

export default Service;
