import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const hex = (bytes: Uint8Array) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: Uint8Array | string) => hex(new Uint8Array(await crypto.subtle.digest(
  'SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value,
)));
const publicSnapshot = (snapshot: any = {}) => ({
  case: {
    number: snapshot.case?.number || null,
    title: snapshot.case?.title || null,
    systemType: snapshot.case?.system_type || null,
    clientName: snapshot.case?.client_name || null,
    installationAddress: snapshot.case?.installation_address || null,
    description: snapshot.case?.description || null,
    equipmentSummary: snapshot.case?.equipment_summary || null,
    resolutionSummary: snapshot.case?.resolution_summary || null,
  },
  visit: snapshot.visit ? {
    visitNumber: snapshot.visit.visit_number || null,
    scheduledStart: snapshot.visit.scheduled_start || null,
    startedAt: snapshot.visit.started_at || null,
    completedAt: snapshot.visit.completed_at || null,
    diagnostics: snapshot.visit.diagnostics || null,
    rootCause: snapshot.visit.root_cause || null,
    workPerformed: snapshot.visit.work_performed || null,
    materials: Array.isArray(snapshot.visit.materials) ? snapshot.visit.materials : [],
    measurements: Array.isArray(snapshot.visit.measurements) ? snapshot.visit.measurements : [],
    safetyChecks: Array.isArray(snapshot.visit.safety_checks) ? snapshot.visit.safety_checks : [],
    recommendations: snapshot.visit.recommendations || null,
    nextAction: snapshot.visit.next_action || null,
    clientStatement: snapshot.visit.client_statement || null,
  } : null,
  photoCount: Array.isArray(snapshot.attachments) ? snapshot.attachments.length : 0,
});
const publicDocument = (row: any, pdfUrl: string | null = null) => ({
  number: row.number, title: row.title, documentType: row.document_type, status: row.status,
  recipientName: row.recipient_name, recipientEmail: row.recipient_email,
  expiresAt: row.signing_expires_at, signedAt: row.signed_at, declinedAt: row.declined_at,
  case: {
    number: row.service_case?.number, title: row.service_case?.title, clientName: row.service_case?.client_name,
    systemType: row.service_case?.system_type, installationAddress: row.service_case?.installation_address,
  },
  snapshot: publicSnapshot(row.document_snapshot), pdfUrl,
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const body = await req.json();
    const token = String(body.token || '');
    const action = String(body.action || 'view');
    if (!/^[0-9a-f]{64}$/i.test(token)) return json({ error: 'Podpisový odkaz není platný.' }, 400);
    if (!['view', 'sign', 'decline'].includes(action)) return json({ error: 'Neplatná akce.' }, 400);
    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    const tokenHash = await sha256(token);
    const { data: document } = await admin.from('service_documents')
      .select('*, service_case:service_case_id(id, number, title, client_name, system_type, installation_address)')
      .eq('signing_token_hash', tokenHash).maybeSingle();
    if (!document) return json({ error: 'Podpisový odkaz nebyl nalezen.' }, 404);
    let pdfUrl: string | null = null;
    if (document.storage_path) {
      const { data } = await admin.storage.from('service-documents').createSignedUrl(document.storage_path, 600);
      pdfUrl = data?.signedUrl || null;
    }
    const expired = !document.signing_expires_at || new Date(document.signing_expires_at).getTime() < Date.now();
    const terminal = ['signed', 'declined', 'cancelled'].includes(document.status);
    if (action === 'view') {
      if (document.status === 'sent') {
        const viewedAt = new Date().toISOString();
        await admin.from('service_documents').update({ status: 'viewed', viewed_at: viewedAt }).eq('id', document.id);
        document.status = 'viewed'; document.viewed_at = viewedAt;
      }
      return json({ document: publicDocument(document, pdfUrl), expired, terminal });
    }
    if (expired) return json({ error: 'Platnost podpisového odkazu vypršela.', expired: true }, 410);
    if (terminal) return json({ document: publicDocument(document, pdfUrl), terminal: true });

    const signerName = String(body.signerName || '').trim().slice(0, 160);
    const signerEmail = String(body.signerEmail || '').trim().toLowerCase().slice(0, 254);
    const note = String(body.note || '').trim().slice(0, 2000);
    if (!signerName) return json({ error: 'Doplňte jméno podepisující osoby.' }, 400);
    const now = new Date().toISOString();
    const forwarded = req.headers.get('x-forwarded-for') || '';
    const ip = forwarded.split(',')[0].trim().slice(0, 80) || null;
    const userAgent = (req.headers.get('user-agent') || '').slice(0, 500) || null;

    if (action === 'decline') {
      if (!note) return json({ error: 'Doplňte důvod odmítnutí.' }, 400);
      await admin.from('service_documents').update({ status: 'declined', declined_at: now, signer_name: signerName, signer_email: signerEmail || null, signer_ip: ip, signer_user_agent: userAgent, consent_text: note }).eq('id', document.id);
      await admin.from('service_events').insert({ service_case_id: document.service_case_id, service_visit_id: document.service_visit_id, service_document_id: document.id, event_type: 'document_declined', summary: `${document.number} odmítl/a ${signerName}`, snapshot: { note } });
      return json({ success: true, status: 'declined' });
    }

    if (body.consent !== true) return json({ error: 'Pro podpis je nutné potvrdit souhlas.' }, 400);
    const signature = String(body.signatureDataUrl || '');
    const match = signature.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return json({ error: 'Podpis má neplatný formát.' }, 400);
    const binary = atob(match[2]);
    if (binary.length < 100 || binary.length > 1048576) return json({ error: 'Podpis má neplatnou velikost.' }, 400);
    const signatureBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const signatureHash = await sha256(signatureBytes);
    const consentText = 'Potvrzuji správnost dokumentu a souhlasím s elektronickým podpisem.';
    const { error: signError } = await admin.from('service_documents').update({
      status: 'signed', signed_at: now, signer_name: signerName, signer_email: signerEmail || null,
      signature_data_url: signature, signature_sha256: signatureHash, signer_ip: ip,
      signer_user_agent: userAgent, consent_text: consentText,
    }).eq('id', document.id);
    if (signError) throw signError;
    await admin.from('service_events').insert({
      service_case_id: document.service_case_id, service_visit_id: document.service_visit_id,
      service_document_id: document.id, event_type: 'document_signed',
      summary: `${document.number} podepsal/a ${signerName}`, snapshot: { signerEmail, signatureHash },
    });
    return json({ success: true, status: 'signed', signedAt: now });
  } catch (error) {
    console.error('[respond-service-document]', error);
    return json({ error: error?.message || 'Podpis se nepodařilo uložit.' }, 500);
  }
});
