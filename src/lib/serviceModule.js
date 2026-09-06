export const serviceTypeLabels = {
  fve: 'FVE', fve_bess: 'FVE + BESS', bess: 'BESS', other: 'Ostatní',
};
export const serviceKindLabels = {
  complaint: 'Reklamace', service: 'Servis', maintenance: 'Údržba', inspection: 'Kontrola',
};
export const serviceStatusLabels = {
  new: 'Nový', triage: 'K posouzení', scheduled: 'Naplánováno', in_progress: 'V řešení',
  waiting_parts: 'Čeká na díly', waiting_client: 'Čeká na klienta', resolved: 'Vyřešeno',
  closed: 'Uzavřeno', cancelled: 'Zrušeno',
};
export const servicePriorityLabels = { low: 'Nízká', normal: 'Běžná', high: 'Vysoká', critical: 'Kritická' };
export const warrantyLabels = { unknown: 'Neověřeno', in_warranty: 'V záruce', out_of_warranty: 'Mimo záruku', goodwill: 'Goodwill' };
export const serviceDocumentLabels = { service_protocol: 'Servisní protokol', handover_protocol: 'Předávací protokol' };

export const statusTone = (status) => ({
  new: 'bg-slate-100 text-slate-700', triage: 'bg-amber-50 text-amber-800', scheduled: 'bg-blue-50 text-blue-800',
  in_progress: 'bg-indigo-50 text-indigo-800', waiting_parts: 'bg-orange-50 text-orange-800',
  waiting_client: 'bg-violet-50 text-violet-800', resolved: 'bg-emerald-50 text-emerald-800',
  closed: 'bg-slate-100 text-slate-600', cancelled: 'bg-rose-50 text-rose-700',
}[status] || 'bg-slate-100 text-slate-700');
export const priorityTone = (priority) => ({
  low: 'text-emerald-700', normal: 'text-slate-600', high: 'text-amber-700', critical: 'text-rose-700',
}[priority] || 'text-slate-600');

export const serviceSafetyChecks = {
  fve: ['Odpojení DC a AC', 'Kontrola bezpečného napětí', 'Kontrola konektorů a kabeláže', 'Kontrola ochranného pospojování', 'Obnovení provozu a kontrola výroby'],
  fve_bess: ['Odpojení DC a AC', 'Bezpečné odpojení baterie', 'Kontrola SOC a teploty článků', 'Kontrola BMS a komunikace', 'Kontrola ochranného pospojování', 'Obnovení provozu a funkční zkouška'],
  bess: ['Bezpečné odpojení baterie', 'Kontrola SOC, SOH a teplot', 'Kontrola BMS a alarmů', 'Kontrola ventilace / chlazení', 'Kontrola protipožárních opatření', 'Funkční zkouška po zásahu'],
  other: ['Bezpečné odpojení zařízení', 'Kontrola pracoviště', 'Funkční zkouška po zásahu'],
};

const lines = (value) => String(value || '').trim();
export const buildServiceProtocolModel = ({ serviceCase, visit, document, attachments = [] }) => {
  const measurements = (visit?.measurements || []).map((item) => `${item.label || item.name || 'Měření'}: ${item.value ?? '-'} ${item.unit || ''}`.trim()).join('\n');
  const checks = (visit?.safety_checks || []).map((item) => `${item.checked === false ? '☐' : '☑'} ${item.label || item}`).join('\n');
  const description = [
    `Nahlášený problém:\n${serviceCase.description}`,
    visit?.diagnostics && `Diagnostika:\n${visit.diagnostics}`,
    visit?.root_cause && `Zjištěná příčina:\n${visit.root_cause}`,
    visit?.work_performed && `Provedené práce:\n${visit.work_performed}`,
    measurements && `Měření:\n${measurements}`,
    checks && `Bezpečnostní kontrola:\n${checks}`,
  ].filter(Boolean).join('\n\n');
  const isHandover = document.document_type === 'handover_protocol';
  return {
    id: document.id,
    document_type: isHandover ? 'handover_full' : 'service_protocol',
    number: document.number,
    title: document.title,
    status: document.status,
    created_at: document.created_at,
    client_name: serviceCase.client_name,
    service_description: description,
    handover_scope: isHandover ? lines(visit?.work_performed || serviceCase.resolution_summary || serviceCase.description) : '',
    notes: [
      visit?.recommendations && `Doporučení: ${visit.recommendations}`,
      visit?.next_action && `Další krok: ${visit.next_action}`,
      visit?.client_statement && `Vyjádření klienta: ${visit.client_statement}`,
      `Fotodokumentace uložená u případu: ${attachments.length} souborů`,
    ].filter(Boolean).join('\n\n'),
    project_id: serviceCase.project_id,
    realizace_id: serviceCase.realizace_id,
    opportunity_id: serviceCase.opportunity_id,
    subject_id: serviceCase.subject_id,
    project: serviceCase.project || { id: serviceCase.project_id, name: '' },
    realization: serviceCase.realizace || { id: serviceCase.realizace_id, name: '' },
    opportunity: serviceCase.opportunity || { id: serviceCase.opportunity_id, number: '', title: '' },
    subject: serviceCase.subject || { id: serviceCase.subject_id, name: serviceCase.client_name, email: serviceCase.client_email, phone: serviceCase.client_phone },
    items: (visit?.materials || []).map((item, index) => ({
      id: `${document.id}-${index}`, code: item.code || '', name: item.name || 'Materiál', description: item.description || '',
      quantity: Number(item.quantity || 1), unit: item.unit || 'ks', condition_note: item.condition || 'Použito při servisu', sort_order: index,
    })),
    defects: visit?.next_action ? [{ id: `${document.id}-next`, title: 'Navazující úkol', description: visit.next_action, severity: 'minor', status: 'open', sort_order: 0 }] : [],
    signatures: document.status === 'signed' ? [{ signer_name: document.signer_name, signer_role: 'Klient', signer_email: document.signer_email, signed_at: document.signed_at }] : [],
  };
};

export const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

export const parseServiceLines = (value, kind) => String(value || '').split('\n').map((row) => row.trim()).filter(Boolean).map((row) => {
  const [first, second, third] = row.split('|').map((part) => part.trim());
  return kind === 'measurement'
    ? { label: first, value: second || '', unit: third || '' }
    : { name: first, quantity: Number(second || 1), unit: third || 'ks' };
});

export const formatServiceDate = (value, withTime = true) => value
  ? new Intl.DateTimeFormat('cs-CZ', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(value))
  : '—';
