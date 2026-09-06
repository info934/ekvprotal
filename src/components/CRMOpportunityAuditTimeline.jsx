import React, { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';

const FIELD_LABELS = { stage: 'Stav', status: 'Status', probability: 'Pravděpodobnost', value: 'Hodnota', owner_member_id: 'Vlastník', expected_close_date: 'Odhad uzavření', title: 'Název', custom_fields: 'Volitelná pole', category: 'Kategorie', business_type: 'Typ obchodu' };
const EVENT_LABELS = { created: 'Obchodní případ vytvořen', updated: 'Údaje obchodního případu změněny', deleted: 'Obchodní případ odstraněn', imported: 'Obchodní případ importován' };
const formatDate = (value) => value ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

const CRMOpportunityAuditTimeline = ({ opportunityId, refreshKey }) => {
  const [events, setEvents] = useState([]);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    let active = true;
    supabase.from('crm_opportunity_events').select('id, event_type, changed_fields, actor_member_id, created_at, actor:actor_member_id(name)').eq('opportunity_id', opportunityId).order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => { if (!active) return; if (error?.code === '42P01') setAvailable(false); else if (!error) setEvents(data || []); });
    return () => { active = false; };
  }, [opportunityId, refreshKey]);
  if (!available || events.length === 0) return null;
  return <div className="mt-5 border-t pt-5"><div className="mb-4 flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-primary" />Audit změn údajů</div><div className="space-y-3">{events.map((event) => { const fields = Object.keys(event.changed_fields || {}).map((key) => FIELD_LABELS[key] || key); return <div key={event.id} className="rounded-lg border bg-slate-50 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{EVENT_LABELS[event.event_type] || event.event_type}</span><span className="text-xs text-muted-foreground">{formatDate(event.created_at)}</span></div><p className="mt-1 text-xs text-muted-foreground">{event.actor?.name || 'Systém'}{fields.length ? ` · ${fields.join(', ')}` : ''}</p></div>; })}</div></div>;
};

export default CRMOpportunityAuditTimeline;
