
import { supabase } from '@/lib/customSupabaseClient';
import {
  DEFAULT_CRM_NUMBERING,
  formatCrmNumber,
  incrementCrmNumbering,
  normalizeCrmNumbering,
  selectCrmNumberingSettings,
} from '@/lib/crmNumbering';

export const handoverProtocolTypeLabels = {
  handover_full: 'Celkový předávací protokol',
  handover_partial: 'Částečný předávací protokol',
  service_protocol: 'Servisní protokol',
  contract: 'Smlouva',
};

export const handoverProtocolStatusLabels = {
  draft: 'Rozpracováno',
  ready_for_signature: 'K podpisu',
  signed: 'Podepsáno',
  cancelled: 'Zrušeno',
  archived: 'Archivováno',
};

export const emptyHandoverItem = () => ({
  id: `new-item-${Date.now()}`,
  code: '',
  name: '',
  description: '',
  quantity: 1,
  unit: 'ks',
  condition_note: '',
  sort_order: 0,
  isNew: true,
});

export const emptyHandoverDefect = () => ({
  id: `new-defect-${Date.now()}`,
  title: '',
  description: '',
  severity: 'minor',
  responsible_party: '',
  due_date: '',
  status: 'open',
  sort_order: 0,
  isNew: true,
});

const protocolSelect = `
  *,
  project:project_id(id, name, code, price),
  realization:realizace_id(id, name, status, linked_project_id),
  opportunity:opportunity_id(id, number, title, value),
  subject:subject_id(id, name, email, phone, ico, dic),
  items:handover_protocol_items(*),
  defects:handover_protocol_defects(*),
  signatures:document_signatures(*)
`;

const sortProtocolChildren = (protocol) => ({
  ...protocol,
  items: [...(protocol.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
  defects: [...(protocol.defects || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
  signatures: [...(protocol.signatures || [])].sort((a, b) => new Date(b.signed_at || 0) - new Date(a.signed_at || 0)),
});

export const listHandoverProtocols = async ({ projectId, realizaceId, opportunityId } = {}) => {
  let query = supabase
    .from('handover_protocols')
    .select(protocolSelect)
    .order('created_at', { ascending: false });

  if (realizaceId) query = query.eq('realizace_id', realizaceId);
  else if (projectId) query = query.eq('project_id', projectId);
  else if (opportunityId) query = query.eq('opportunity_id', opportunityId);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(sortProtocolChildren);
};

export const loadHandoverTemplates = async (documentType) => {
  const { data, error } = await supabase
    .from('order_templates')
    .select('id, name, content, document_category')
    .eq('is_active', true)
    .in('document_category', [documentType, 'generic'])
    .order('name');
  if (error) throw error;
  return data || [];
};

const getNextProtocolNumber = async (documentType) => {
  const settingsResult = await selectCrmNumberingSettings(supabase);
  const settings = normalizeCrmNumbering(settingsResult.error ? Object.values(DEFAULT_CRM_NUMBERING) : settingsResult.data);
  const number = formatCrmNumber(settings, documentType);
  const nextNumber = Number(settings[documentType]?.next_number || 1) + 1;
  await incrementCrmNumbering(supabase, documentType, nextNumber);
  return number;
};

export const createHandoverProtocol = async ({
  documentType = 'handover_full',
  project = null,
  realization = null,
  opportunity = null,
  subjectId = null,
  createdBy = null,
} = {}) => {
  const number = await getNextProtocolNumber(documentType);
  const title = `${handoverProtocolTypeLabels[documentType] || 'Dokument'} ${number}`;
  const { data, error } = await supabase
    .from('handover_protocols')
    .insert({
      document_type: documentType,
      status: 'draft',
      number,
      title,
      project_id: project?.id || realization?.linked_project_id || null,
      realizace_id: realization?.id || null,
      opportunity_id: opportunity?.id || null,
      subject_id: subjectId || null,
      handover_scope: documentType === 'service_protocol' ? '' : 'Rozsah předání bude doplněn.',
      service_description: documentType === 'service_protocol' ? 'Popis servisního zásahu bude doplněn.' : '',
      signature_provider: 'internal',
      created_by: createdBy,
    })
    .select(protocolSelect)
    .single();
  if (error) throw error;
  return sortProtocolChildren(data);
};

export const saveHandoverProtocol = async (protocol) => {
  const protocolId = protocol.id;
  const locked = Boolean(protocol.locked_at || protocol.status === 'signed');
  if (locked) throw new Error('Podepsaný protokol je uzamčený a nelze ho upravit.');

  const { data, error } = await supabase
    .from('handover_protocols')
    .update({
      title: protocol.title?.trim() || handoverProtocolTypeLabels[protocol.document_type] || 'Protokol',
      status: protocol.status || 'draft',
      subject_id: protocol.subject_id || null,
      handover_scope: protocol.handover_scope || null,
      service_description: protocol.service_description || null,
      notes: protocol.notes || null,
      signature_provider: protocol.signature_provider || 'internal',
      updated_at: new Date().toISOString(),
    })
    .eq('id', protocolId)
    .select(protocolSelect)
    .single();
  if (error) throw error;

  await supabase.from('handover_protocol_items').delete().eq('protocol_id', protocolId);
  const items = (protocol.items || [])
    .filter((item) => String(item.name || '').trim())
    .map((item, index) => ({
      protocol_id: protocolId,
      catalog_item_id: item.catalog_item_id || null,
      code: item.code || null,
      name: item.name.trim(),
      description: item.description || null,
      quantity: Number(item.quantity || 1),
      unit: item.unit || 'ks',
      condition_note: item.condition_note || null,
      sort_order: (index + 1) * 10,
    }));
  if (items.length) {
    const { error: itemError } = await supabase.from('handover_protocol_items').insert(items);
    if (itemError) throw itemError;
  }

  await supabase.from('handover_protocol_defects').delete().eq('protocol_id', protocolId);
  const defects = (protocol.defects || [])
    .filter((defect) => String(defect.title || '').trim())
    .map((defect, index) => ({
      protocol_id: protocolId,
      title: defect.title.trim(),
      description: defect.description || null,
      severity: defect.severity || 'minor',
      responsible_party: defect.responsible_party || null,
      due_date: defect.due_date || null,
      status: defect.status || 'open',
      sort_order: (index + 1) * 10,
    }));
  if (defects.length) {
    const { error: defectError } = await supabase.from('handover_protocol_defects').insert(defects);
    if (defectError) throw defectError;
  }

  return data;
};

const hashProtocol = async (protocol, signatureDataUrl) => {
  const payload = JSON.stringify({
    id: protocol.id,
    number: protocol.number,
    title: protocol.title,
    items: protocol.items || [],
    defects: protocol.defects || [],
    signatureDataUrl,
  });
  if (!window.crypto?.subtle) return btoa(unescape(encodeURIComponent(payload))).slice(0, 64);
  const buffer = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const signHandoverProtocol = async (protocol, signature) => {
  const signedHash = await hashProtocol(protocol, signature.signatureDataUrl);
  const { error: signatureError } = await supabase.from('document_signatures').insert({
    protocol_id: protocol.id,
    signer_name: signature.signerName,
    signer_role: signature.signerRole || 'Zákazník',
    signer_email: signature.signerEmail || null,
    signature_type: 'internal',
    signature_data_url: signature.signatureDataUrl,
    signed_document_hash: signedHash,
    user_agent: window.navigator?.userAgent || null,
  });
  if (signatureError) throw signatureError;

  const { data, error } = await supabase
    .from('handover_protocols')
    .update({
      status: 'signed',
      locked_at: new Date().toISOString(),
      signed_document_hash: signedHash,
    })
    .eq('id', protocol.id)
    .select(protocolSelect)
    .single();
  if (error) throw error;
  return sortProtocolChildren(data);
};
