import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { authorizeFunctionRequest } from '../_shared/authorize.ts';
import { fetchWithTimeout } from '../_shared/fetch.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const bytesFromBase64 = (value: string) => {
  const binary = atob(value.replace(/^data:application\/pdf;base64,/, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
const hex = (bytes: Uint8Array) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: Uint8Array) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', value)));

const emailHtml = (title: string, caseNumber: string, message: string, signingUrl: string) => `<!doctype html><html lang="cs"><body style="margin:0;background:#eef2f7;font-family:Arial,sans-serif;color:#101828">
<div style="max-width:680px;margin:0 auto;padding:28px 16px"><div style="height:6px;background:#2459c7;border-radius:999px"></div>
<div style="margin-top:10px;background:#fff;border:1px solid #d7e0ec;border-radius:14px;padding:28px"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#2459c7">EKV PROJECT · SERVIS</div>
<h1 style="font-size:24px;margin:10px 0">${escapeHtml(title)}</h1><p style="color:#667085">Servisní případ ${escapeHtml(caseNumber)}</p>
<div style="font-size:15px;line-height:1.65;color:#344054">${escapeHtml(message).replaceAll('\n', '<br>')}</div>
<p style="margin:24px 0 0"><a href="${escapeHtml(signingUrl)}" style="display:inline-block;background:#2459c7;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px">Otevřít dokument a podepsat</a></p>
<p style="margin:20px 0 0;color:#667085;font-size:13px">PDF je přiloženo. Podpisový odkaz je osobní a platí 30 dní.</p></div>
<p style="text-align:center;color:#98a2b3;font-size:12px">EKV Project s.r.o. · info@ekvproject.cz</p></div></body></html>`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const actor = await authorizeFunctionRequest(req, { module: 'service', level: 'edit' });
    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
    if (!resendApiKey) throw new Error('E-mailová služba není nakonfigurována.');
    const body = await req.json();
    const documentId = String(body.documentId || '');
    const recipientName = String(body.recipientName || '').trim().slice(0, 160);
    const recipientEmail = String(body.recipientEmail || '').trim().toLowerCase();
    const message = String(body.message || '').trim().slice(0, 5000);
    const pdfBase64 = String(body.pdfBase64 || '');
    if (!/^[0-9a-f-]{36}$/i.test(documentId)) return json({ error: 'Neplatný dokument.' }, 400);
    if (!emailPattern.test(recipientEmail)) return json({ error: 'Zkontrolujte e-mail příjemce.' }, 400);
    if (!message || !pdfBase64) return json({ error: 'Zpráva a PDF jsou povinné.' }, 400);

    const { data: document } = await admin.from('service_documents')
      .select('*, service_case:service_case_id(id, number, client_email)')
      .eq('id', documentId).maybeSingle();
    if (!document) return json({ error: 'Dokument nebyl nalezen.' }, 404);
    if (['sent', 'viewed', 'signed'].includes(document.status)) return json({ success: true, duplicate: true, status: document.status });
    if (document.status === 'cancelled') return json({ error: 'Zrušený dokument nelze odeslat.' }, 409);

    const bytes = bytesFromBase64(pdfBase64);
    if (bytes.byteLength < 100 || bytes.byteLength > 10 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
      return json({ error: 'PDF má neplatný formát nebo velikost.' }, 400);
    }
    const pdfHash = await sha256(bytes);
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const tokenHash = await sha256(new TextEncoder().encode(token));
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const path = `${document.service_case_id}/${document.id}/${document.number.replace(/[^a-zA-Z0-9._-]+/g, '_')}.pdf`;
    const { error: uploadError } = await admin.storage.from('service-documents').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw uploadError;

    const portalUrl = (Deno.env.get('PORTAL_PUBLIC_URL') || Deno.env.get('SITE_URL') || 'https://portal.ekvproject.cz').replace(/\/$/, '');
    const signingUrl = `${portalUrl}/service-sign/${token}`;
    const subject = `${document.title} · ${document.service_case?.number || ''}`;
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM_EMAIL') || 'EKV Project <portal@web.ekvproject.cz>',
        to: [recipientEmail], subject,
        html: emailHtml(document.title, document.service_case?.number || '', message, signingUrl),
        attachments: [{ filename: `${document.number}.pdf`, content: pdfBase64.replace(/^data:application\/pdf;base64,/, '') }],
      }),
    });
    const provider = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(provider?.message || 'E-mail nebyl přijat poskytovatelem.');
    const sentAt = new Date().toISOString();
    const { error: updateError } = await admin.from('service_documents').update({
      status: 'sent', recipient_name: recipientName || null, recipient_email: recipientEmail,
      storage_path: path, pdf_sha256: pdfHash, pdf_size_bytes: bytes.byteLength,
      signing_token_hash: tokenHash, signing_expires_at: expiresAt, sent_at: sentAt,
    }).eq('id', document.id);
    if (updateError) throw updateError;
    await admin.from('service_events').insert({
      service_case_id: document.service_case_id, service_visit_id: document.service_visit_id,
      service_document_id: document.id, event_type: 'document_sent',
      summary: `${document.number} odeslán na ${recipientEmail}`,
      snapshot: { recipientName, recipientEmail, providerMessageId: provider.id || null }, actor_member_id: actor.memberId,
    });
    return json({ success: true, status: 'sent', expiresAt });
  } catch (error) {
    console.error('[send-service-document]', error);
    return json({ error: error?.message || 'Odeslání se nepodařilo.' }, error?.status || 500);
  }
});
