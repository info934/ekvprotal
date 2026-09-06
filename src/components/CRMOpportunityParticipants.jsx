import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Mail, Phone, Plus, Trash2, User, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

const ROLE_LABELS = {
  decision_maker: 'Rozhodovatel', technical_contact: 'Technický kontakt', customer_contact: 'Kontakt klienta',
  supplier: 'Dodavatel', partner: 'Partner', advisor: 'Poradce', observer: 'Na vědomí', stakeholder: 'Účastník',
};
const emptyDraft = { source: 'external', source_id: '', name: '', organization: '', role: 'stakeholder', email: '', phone: '', notes: '', is_primary: false };

const CRMOpportunityParticipants = ({ opportunityId, primarySubject, canEdit }) => {
  const { memberId } = useAuth();
  const { toast } = useToast();
  const [participants, setParticipants] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [members, setMembers] = useState([]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    const [participantRes, subjectRes, memberRes] = await Promise.all([
      supabase.from('crm_opportunity_participants').select('id, subject_id, member_id, name, organization, role, email, phone, notes, is_primary, created_at').eq('opportunity_id', opportunityId).order('is_primary', { ascending: false }).order('created_at'),
      supabase.from('subjects').select('id, name, email, phone').order('name').limit(1000),
      supabase.from('members').select('id, name, email, phone').eq('is_active', true).order('name'),
    ]);
    if (participantRes.error?.code === '42P01') { setAvailable(false); return; }
    if (participantRes.error) throw participantRes.error;
    setParticipants(participantRes.data || []);
    setSubjects(subjectRes.data || []);
    setMembers(memberRes.data || []);
  }, [opportunityId]);

  useEffect(() => { load().catch((error) => toast({ title: 'Účastníky nelze načíst', description: error.message, variant: 'destructive' })); }, [load, toast]);

  const selectSource = (source, sourceId) => {
    const row = (source === 'subject' ? subjects : members).find((item) => item.id === sourceId);
    setDraft((current) => ({ ...current, source, source_id: sourceId, name: row?.name || '', organization: source === 'subject' ? row?.name || '' : '', email: row?.email || '', phone: row?.phone || '' }));
  };

  const save = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    const payload = {
      opportunity_id: opportunityId, subject_id: draft.source === 'subject' ? draft.source_id : null,
      member_id: draft.source === 'member' ? draft.source_id : null, name: draft.name.trim(), organization: draft.organization.trim() || null,
      role: draft.role, email: draft.email.trim() || null, phone: draft.phone.trim() || null, notes: draft.notes.trim() || null,
      is_primary: Boolean(draft.is_primary), created_by_member_id: memberId || null,
    };
    const { error } = await supabase.from('crm_opportunity_participants').insert(payload);
    setSaving(false);
    if (error) { toast({ title: 'Účastníka nelze přidat', description: error.message, variant: 'destructive' }); return; }
    setOpen(false); setDraft(emptyDraft); await load();
    toast({ title: 'Účastník přidán' });
  };

  const remove = async (id) => {
    const { error } = await supabase.from('crm_opportunity_participants').delete().eq('id', id);
    if (error) { toast({ title: 'Účastníka nelze odebrat', description: error.message, variant: 'destructive' }); return; }
    setParticipants((current) => current.filter((item) => item.id !== id));
  };

  if (!available) return <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Účastníci budou dostupní po nasazení CRM migrace.</div>;
  return <div className="space-y-4 rounded-lg border bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-primary" />Lidé a firmy v obchodním případu</div><p className="mt-1 text-sm text-muted-foreground">Rozhodovatelé, technické kontakty, partneři a interní tým.</p></div>{canEdit && <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Přidat účastníka</Button>}</div>
    {primarySubject && <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3"><Building2 className="h-5 w-5 text-blue-700" /><div className="min-w-0 flex-1"><div className="font-semibold text-blue-950">{primarySubject.name}</div><div className="text-xs text-blue-700">Hlavní klient</div></div>{primarySubject.email && <Button asChild size="icon" variant="ghost"><a href={`mailto:${primarySubject.email}`} aria-label="Napsat klientovi"><Mail className="h-4 w-4" /></a></Button>}</div>}
    {participants.length === 0 ? <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Další účastníci zatím nejsou přidáni.</div> : <div className="grid gap-3 lg:grid-cols-2">{participants.map((participant) => <div key={participant.id} className="rounded-lg border p-3"><div className="flex items-start gap-3"><User className="mt-0.5 h-5 w-5 text-slate-500" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{participant.name}</span><Badge variant="outline">{ROLE_LABELS[participant.role] || participant.role}</Badge>{participant.is_primary && <Badge>Klíčový</Badge>}</div>{participant.organization && participant.organization !== participant.name && <p className="text-sm text-muted-foreground">{participant.organization}</p>}<div className="mt-2 flex flex-wrap gap-3 text-sm">{participant.email && <a className="inline-flex items-center gap-1 text-primary" href={`mailto:${participant.email}`}><Mail className="h-3.5 w-3.5" />{participant.email}</a>}{participant.phone && <a className="inline-flex items-center gap-1 text-primary" href={`tel:${participant.phone}`}><Phone className="h-3.5 w-3.5" />{participant.phone}</a>}</div>{participant.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{participant.notes}</p>}</div>{canEdit && <Button size="icon" variant="ghost" onClick={() => remove(participant.id)} aria-label={`Odebrat ${participant.name}`}><Trash2 className="h-4 w-4" /></Button>}</div></div>)}</div>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>Přidat účastníka</DialogTitle></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Zdroj kontaktu</Label><Select value={draft.source} onValueChange={(source) => setDraft({ ...emptyDraft, source })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="external">Nový kontakt</SelectItem><SelectItem value="subject">Firma nebo osoba z adresáře</SelectItem><SelectItem value="member">Zaměstnanec EKV</SelectItem></SelectContent></Select></div>{draft.source !== 'external' && <div className="space-y-2"><Label>{draft.source === 'subject' ? 'Subjekt' : 'Zaměstnanec'}</Label><Select value={draft.source_id} onValueChange={(value) => selectSource(draft.source, value)}><SelectTrigger><SelectValue placeholder="Vyberte záznam" /></SelectTrigger><SelectContent>{(draft.source === 'subject' ? subjects : members).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>}<div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Jméno *</Label><Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></div><div className="space-y-2"><Label>Role</Label><Select value={draft.role} onValueChange={(role) => setDraft((current) => ({ ...current, role }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ROLE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Organizace</Label><Input value={draft.organization} onChange={(event) => setDraft((current) => ({ ...current, organization: event.target.value }))} /></div><div className="space-y-2"><Label>Email</Label><Input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></div><div className="space-y-2"><Label>Telefon</Label><Input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></div><label className="flex items-end gap-2 pb-2 text-sm font-medium"><input type="checkbox" checked={draft.is_primary} onChange={(event) => setDraft((current) => ({ ...current, is_primary: event.target.checked }))} className="h-4 w-4" />Klíčový účastník</label></div><div className="space-y-2"><Label>Poznámka</Label><Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button><Button onClick={save} disabled={saving || !draft.name.trim()}>{saving ? 'Ukládám…' : 'Přidat'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
};

export default CRMOpportunityParticipants;
