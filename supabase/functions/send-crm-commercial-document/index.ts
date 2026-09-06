import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { authorizeFunctionRequest } from '../_shared/authorize.ts';
import { fetchWithTimeout } from '../_shared/fetch.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmails = (value: unknown) => Array.from(new Set(
  (Array.isArray(value) ? value : String(value || '').split(/[;,\n]/))
    .map((email) => String(email).trim().toLowerCase())
    .filter(Boolean),
));

const bytesFromBase64 = (value: string) => {
  const binary = atob(value.replace(/^data:application\/pdf;base64,/, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const sha256 = async (value: Uint8Array) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', value)),
).map((byte) => byte.toString(16).padStart(2, '0')).join('');

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const brandedEmail = ({ subject, messageHtml, responseUrl, documentLabel }: {
  subject: string;
  messageHtml: string;
  responseUrl: string | null;
  documentLabel: string;
}) => `<!doctype html><html lang="cs"><body style="margin:0;background:#eef2f7;font-family:Arial,sans-serif;color:#101828">
  <div style="max-width:680px;margin:0 auto;padding:28px 16px">
    <div style="height:6px;border-radius:999px;background:linear-gradient(90deg,#153b82,#2459c7,#2f8f5b)"></div>
    <div style="background:#fff;border:1px solid #d7e0ec;border-radius:14px;padding:28px;margin-top:10px">
      <div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#2459c7">EKV PROJECT</div>
      <h1 style="font-size:24px;line-height:1.2;margin:10px 0 18px">${escapeHtml(subject)}</h1>
      <div style="font-size:15px;line-height:1.65;color:#344054">${messageHtml}</div>
      ${responseUrl ? `<div style="margin-top:24px"><a href="${escapeHtml(responseUrl)}" style="display:inline-block;background:#2459c7;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Otevřít a potvrdit ${escapeHtml(documentLabel.toLowerCase())}</a></div>` : ''}
      <p style="margin:24px 0 0;color:#667085;font-size:13px">PDF dokument je přiložen k tomuto e-mailu.</p>
    </div>
    <p style="text-align:center;color:#98a2b3;font-size:12px">EKV Project s.r.o. · Papírnická 2809/16, Plzeň · info@ekvproject.cz</p>
  </div></body></html>`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let deliveryId: string | null = null;
  try {
    const actor = await authorizeFunctionRequest(req, { module: 'crm', level: 'edit' });
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
    if (!supabaseUrl || !serviceRoleKey || !resendApiKey) throw new Error('E-mailová služba není nakonfigurována.');
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();
    const documentId = String(body.documentId || '');
    const idempotencyKey = String(body.idempotencyKey || '');
    const recipients = normalizeEmails(body.recipients);
    const ccRecipients = normalizeEmails(body.ccRecipients);
    const subject = String(body.subject || '').trim().slice(0, 180);
    const messageHtml = String(body.messageHtml || '').trim().slice(0, 12000);
    const pdfBase64 = String(body.pdfBase64 || '');
    const customRecipientConfirmed = body.customRecipientConfirmed === true;
    const templateId = body.templateId ? String(body.templateId) : null;
    const snapshot = body.snapshot && typeof body.snapshot === 'object' ? body.snapshot : {};

    if (!documentId || !/^[0-9a-f-]{36}$/i.test(documentId)) return json({ error: 'Neplatný dokument.' }, 400);
    if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) return json({ error: 'Neplatný klíč odeslání.' }, 400);
    if (!recipients.length || recipients.length > 10 || !recipients.every((email) => emailPattern.test(email))) return json({ error: 'Zkontrolujte adresy příjemců.' }, 400);
    if (ccRecipients.length > 10 || !ccRecipients.every((email) => emailPattern.test(email))) return json({ error: 'Zkontrolujte adresy v kopii.' }, 400);
    if (!subject || !messageHtml) return json({ error: 'Předmět a zpráva jsou povinné.' }, 400);
    if (!pdfBase64) return json({ error: 'PDF příloha chybí.' }, 400);

    const { data: existing } = await admin.from('crm_commercial_document_deliveries')
      .select('id, status, provider_message_id, sent_at').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing?.status === 'sent') return json({ success: true, duplicate: true, delivery: existing });
    if (existing?.id) return json({ error: 'Toto odeslání se již zpracovává nebo selhalo. Obnovte detail dokumentu.' }, 409);

    const { data: document, error: documentError } = await admin.from('crm_commercial_documents')
      .select('*, subject:subject_id(id, name, email), opportunity:opportunity_id(id, number, title, project_id)')
      .eq('id', documentId).is('deleted_at', null).maybeSingle();
    if (documentError || !document) return json({ error: 'Dokument nebyl nalezen.' }, 404);
    if (document.cancelled_at || document.status === 'cancelled') return json({ error: 'Stornovaný dokument nelze odeslat.' }, 409);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin.from('crm_commercial_document_deliveries').select('id', { count: 'exact', head: true })
      .eq('sent_by_member_id', actor.memberId).gte('created_at', oneHourAgo);
    if ((count || 0) >= 20) return json({ error: 'Byl dosažen bezpečnostní limit 20 odeslání za hodinu.' }, 429);

    const clientEmail = String(document.subject?.email || '').trim().toLowerCase();
    const hasForeignRecipient = recipients.some((email) => email !== clientEmail);
    if (hasForeignRecipient && !customRecipientConfirmed) {
      return json({ error: 'Příjemce se liší od e-mailu uloženého u klienta. Potvrďte tuto adresu.' }, 400);
    }

    const pdfBytes = bytesFromBase64(pdfBase64);
    if (pdfBytes.byteLength < 100 || pdfBytes.byteLength > 10 * 1024 * 1024) return json({ error: 'PDF má neplatnou velikost.' }, 400);
    if (new TextDecoder().decode(pdfBytes.slice(0, 5)) !== '%PDF-') return json({ error: 'Příloha není platné PDF.' }, 400);
    const pdfHash = await sha256(pdfBytes);
    const safeNumber = String(document.number || document.id).replace(/[^a-zA-Z0-9._-]+/g, '_');
    const { data: latestVersion } = await admin.from('crm_commercial_document_versions')
      .select('version_number').eq('document_id', documentId).order('version_number', { ascending: false }).limit(1).maybeSingle();
    const versionNumber = Number(latestVersion?.version_number || 0) + 1;
    const fileName = `${document.type === 'offer' ? 'Nabidka' : 'Objednavka'}_${safeNumber}_V${versionNumber}.pdf`;
    const storagePath = `${documentId}/${idempotencyKey}.pdf`;
    const { error: uploadError } = await admin.storage.from('crm-commercial-documents').upload(storagePath, pdfBytes, {
      contentType: 'application/pdf', upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data: version, error: versionError } = await admin.from('crm_commercial_document_versions').insert({
      document_id: documentId,
      version_number: versionNumber,
      snapshot,
      template_id: templateId,
      storage_path: storagePath,
      file_name: fileName,
      pdf_sha256: pdfHash,
      pdf_size_bytes: pdfBytes.byteLength,
      created_by_member_id: actor.memberId,
    }).select('*').single();
    if (versionError) throw versionError;

    let responseToken: string | null = null;
    let responseTokenHash: string | null = null;
    let responseExpiresAt: string | null = null;
    if (document.type === 'offer') {
      const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
      responseToken = Array.from(tokenBytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      responseTokenHash = await sha256(new TextEncoder().encode(responseToken));
      const defaultExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const validUntil = document.valid_until ? new Date(`${document.valid_until}T23:59:59+02:00`).getTime() : defaultExpiry;
      responseExpiresAt = new Date(Math.max(Date.now() + 60 * 60 * 1000, Math.min(defaultExpiry, validUntil))).toISOString();
    }

    const { data: delivery, error: deliveryError } = await admin.from('crm_commercial_document_deliveries').insert({
      document_id: documentId,
      version_id: version.id,
      idempotency_key: idempotencyKey,
      recipients,
      cc_recipients: ccRecipients,
      subject,
      message_html: messageHtml,
      custom_recipient_confirmed: customRecipientConfirmed,
      response_token_hash: responseTokenHash,
      response_expires_at: responseExpiresAt,
      sent_by_member_id: actor.memberId,
    }).select('*').single();
    if (deliveryError) throw deliveryError;
    deliveryId = delivery.id;

    const portalUrl = (Deno.env.get('PORTAL_PUBLIC_URL') || 'https://portal.ekvproject.cz').replace(/\/$/, '');
    const responseUrl = responseToken ? `${portalUrl}/offer-response/${responseToken}` : null;
    const documentLabel = document.type === 'offer' ? 'Nabídka' : 'Objednávka';
    const providerResponse = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
      body: JSON.stringify({
        from: 'EKV Project <portal@web.ekvproject.cz>',
        to: recipients,
        ...(ccRecipients.length ? { cc: ccRecipients } : {}),
        subject,
        html: brandedEmail({ subject, messageHtml, responseUrl, documentLabel }),
        attachments: [{ filename: fileName, content: pdfBase64.replace(/^data:application\/pdf;base64,/, '') }],
      }),
    });
    const providerPayload = await providerResponse.json().catch(() => ({}));
    if (!providerResponse.ok) throw new Error(providerPayload?.message || 'Poskytovatel e-mail nepřijal.');

    const sentAt = new Date().toISOString();
    await admin.from('crm_commercial_document_deliveries').update({
      status: 'sent', provider_message_id: providerPayload.id || null, sent_at: sentAt,
    }).eq('id', delivery.id);
    await admin.from('crm_commercial_documents').update({
      status: document.status === 'draft' ? 'sent' : document.status,
      sent_at: sentAt,
      current_version: versionNumber,
      sync_items: false,
    }).eq('id', documentId);
    await admin.from('crm_commercial_document_events').insert({
      document_id: documentId, version_id: version.id, delivery_id: delivery.id,
      event_type: 'sent', summary: `${documentLabel} V${versionNumber} odeslána`,
      metadata: { recipients, ccRecipients, providerMessageId: providerPayload.id || null },
      actor_member_id: actor.memberId,
    });
    await admin.from('audit_logs').insert({
      user_id: actor.userId, action: 'crm_commercial_document_sent',
      details: { documentId, versionId: version.id, deliveryId: delivery.id, recipients, customRecipientConfirmed },
    });

    return json({ success: true, version, delivery: { ...delivery, status: 'sent', sent_at: sentAt }, responseUrl });
  } catch (error) {
    console.error('[send-crm-commercial-document]', error);
    if (deliveryId) {
      const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
      await admin.from('crm_commercial_document_deliveries').update({
        status: 'failed', error_message: String(error?.message || error).slice(0, 1000),
      }).eq('id', deliveryId);
    }
    return json({ error: error?.message || 'Odeslání se nepodařilo.' }, error?.status || 500);
  }
});
