import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchWithTimeout } from '../_shared/fetch.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const sha256 = async (value: string) => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)))
  .map((byte) => byte.toString(16).padStart(2, '0')).join('');
const deterministicUuid = async (value: string) => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes.slice(0, 16)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const base64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const expectedSecret = Deno.env.get('CRM_REMINDER_SECRET');
  if (!expectedSecret || req.headers.get('x-cron-secret') !== expectedSecret) return json({ error: 'Unauthorized.' }, 401);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
    if (!resendApiKey) throw new Error('E-mailová služba není nakonfigurována.');
    const now = new Date();
    const inactivityCutoff = new Date(now.getTime() - 5 * 86400000).toISOString();
    const reminderCutoff = new Date(now.getTime() - 7 * 86400000).toISOString();
    const today = now.toISOString().slice(0, 10);
    const { data: offers, error } = await admin.from('crm_commercial_documents')
      .select('id, number, title, valid_until, reminder_count, sent_at, subject:subject_id(name, email)')
      .eq('type', 'offer').eq('status', 'sent').is('deleted_at', null)
      .or(`valid_until.is.null,valid_until.gte.${today}`).lte('sent_at', inactivityCutoff).lt('reminder_count', 3)
      .or(`last_reminder_at.is.null,last_reminder_at.lte.${reminderCutoff}`)
      .order('valid_until').limit(50);
    if (error) throw error;
    const results: Array<Record<string, unknown>> = [];
    const portalUrl = (Deno.env.get('PORTAL_PUBLIC_URL') || 'https://portal.ekvproject.cz').replace(/\/$/, '');

    for (const offer of offers || []) {
      const recipient = String(offer.subject?.email || '').trim().toLowerCase();
      if (!recipient) { results.push({ documentId: offer.id, skipped: 'missing_recipient' }); continue; }
      const { data: previous } = await admin.from('crm_commercial_document_deliveries')
        .select('version_id, subject').eq('document_id', offer.id).eq('status', 'sent')
        .order('sent_at', { ascending: false }).limit(1).maybeSingle();
      if (!previous?.version_id) { results.push({ documentId: offer.id, skipped: 'missing_version' }); continue; }
      const { data: version } = await admin.from('crm_commercial_document_versions')
        .select('*').eq('id', previous.version_id).maybeSingle();
      if (!version) { results.push({ documentId: offer.id, skipped: 'missing_version' }); continue; }
      const { data: file, error: fileError } = await admin.storage.from('crm-commercial-documents').download(version.storage_path);
      if (fileError || !file) { results.push({ documentId: offer.id, skipped: 'missing_pdf' }); continue; }
      const pdfBase64 = base64(new Uint8Array(await file.arrayBuffer()));
      const rawToken = token();
      const expiresAt = offer.valid_until
        ? new Date(`${offer.valid_until}T23:59:59+02:00`).toISOString()
        : new Date(Date.now() + 30 * 86400000).toISOString();
      const deliveryIdempotency = await deterministicUuid(`${offer.id}:reminder:${today}`);
      const { data: delivery, error: deliveryError } = await admin.from('crm_commercial_document_deliveries').insert({
        document_id: offer.id, version_id: version.id, idempotency_key: deliveryIdempotency,
        recipients: [recipient], subject: `Připomenutí: ${previous.subject || `Nabídka ${offer.number}`}`,
        message_html: 'Připomínka nabídky čekající na vyjádření klienta.',
        response_token_hash: await sha256(rawToken), response_expires_at: expiresAt,
      }).select('*').single();
      if (deliveryError?.code === '23505') { results.push({ documentId: offer.id, skipped: 'already_processed_today' }); continue; }
      if (deliveryError) { results.push({ documentId: offer.id, error: deliveryError.message }); continue; }
      const responseUrl = `${portalUrl}/offer-response/${rawToken}`;
      const provider = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
        body: JSON.stringify({
          from: 'EKV Project <portal@web.ekvproject.cz>', to: [recipient],
          subject: delivery.subject,
          html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto"><h2>Nabídka ${escapeHtml(offer.number)}</h2><p>Dobrý den, připomínáme nabídku <strong>${escapeHtml(offer.title)}</strong>, která čeká na vaše vyjádření.</p>${offer.valid_until ? `<p>Platnost nabídky je do <strong>${escapeHtml(offer.valid_until)}</strong>.</p>` : ''}<p><a style="display:inline-block;background:#2459c7;color:white;padding:12px 18px;border-radius:8px;text-decoration:none" href="${escapeHtml(responseUrl)}">Otevřít nabídku a odpovědět</a></p><p>S pozdravem<br>EKV Project</p></div>`,
          attachments: [{ filename: version.file_name, content: pdfBase64 }],
        }),
      });
      const providerBody = await provider.json().catch(() => ({}));
      if (!provider.ok) {
        await admin.from('crm_commercial_document_deliveries').update({ status: 'failed', error_message: providerBody?.message || 'Provider error' }).eq('id', delivery.id);
        results.push({ documentId: offer.id, error: 'provider_rejected' });
        continue;
      }
      const sentAt = new Date().toISOString();
      await admin.from('crm_commercial_document_deliveries').update({ status: 'sent', provider_message_id: providerBody.id || null, sent_at: sentAt }).eq('id', delivery.id);
      await admin.from('crm_commercial_documents').update({ reminder_count: Number(offer.reminder_count || 0) + 1, last_reminder_at: sentAt }).eq('id', offer.id);
      await admin.from('crm_commercial_document_events').insert({ document_id: offer.id, version_id: version.id, delivery_id: delivery.id, event_type: 'reminder_sent', summary: 'Klientovi byla odeslána připomínka nabídky', metadata: { recipient } });
      results.push({ documentId: offer.id, success: true });
    }
    return json({ success: true, processed: results.length, results });
  } catch (error) {
    console.error('[send-crm-commercial-reminders]', error);
    return json({ error: error?.message || 'Připomínky se nepodařilo zpracovat.' }, 500);
  }
});
