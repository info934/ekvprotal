import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { sendTrackedEmail } from '../_shared/emailDelivery.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] || char));
const fileNameOk = (value: unknown) => /^[a-zA-Z0-9._ -]{1,120}\.pdf$/i.test(String(value || ''));
const base64Ok = (value: unknown) => /^JVBERi0[A-Za-z0-9+/=\r\n]+$/.test(String(value || ''));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
    if (!url || !serviceKey || !resendApiKey) throw Object.assign(new Error('E-mailová služba není nakonfigurována.'), { status: 503 });
    const admin = createClient(url, serviceKey);
    const suppliedSecret = req.headers.get('x-realization-retention-secret') || '';
    const { data: valid, error: secretError } = await admin.rpc('verify_realization_retention_cron_secret', { p_secret: suppliedSecret });
    if (secretError || !valid) return json({ error: 'Unauthorized.' }, 401);

    const body = await req.json().catch(() => ({}));
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
    if (!attachments.length || attachments.length > 10) return json({ error: 'Přiložte 1 až 10 PDF souborů.' }, 400);
    let totalBytes = 0;
    for (const attachment of attachments) {
      if (!fileNameOk(attachment?.filename) || !base64Ok(attachment?.content)) return json({ error: 'Přílohy musí být platné PDF soubory.' }, 400);
      totalBytes += Math.ceil(String(attachment.content).length * 3 / 4);
    }
    if (totalBytes > 12 * 1024 * 1024) return json({ error: 'Přílohy jsou příliš velké.' }, 413);
    const names = attachments.map((item: any) => String(item.filename));
    const list = names.map((name: string) => `<li style="margin:5px 0">${escapeHtml(name)}</li>`).join('');
    const idempotencyKey = String(body?.idempotencyKey || '');
    if (!/^[a-zA-Z0-9:._-]{12,160}$/.test(idempotencyKey)) return json({ error: 'Neplatný klíč testovací sady.' }, 400);
    const html = `<!doctype html><html lang="cs"><body style="margin:0;background:#eef2f7;font-family:Arial,sans-serif;color:#101828"><div style="max-width:680px;margin:auto;padding:28px 16px"><div style="height:6px;border-radius:999px;background:linear-gradient(90deg,#153b82,#2459c7,#2f8f5b)"></div><main style="margin-top:10px;padding:28px;border:1px solid #d7e0ec;border-radius:14px;background:#fff"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#2459c7">EKV PROJECT · TEST DOKUMENTŮ</div><h1 style="margin:10px 0 12px;font-size:25px">Sada dokumentů ke kontrole vzhledu</h1><p style="color:#475467;line-height:1.6">V příloze jsou testovací dokumenty vytvořené aktuálními generátory portálu. Používají výhradně smyšlená data a slouží ke kontrole firemní identity, čitelnosti a stránkování A4.</p><ul style="padding-left:22px;line-height:1.5">${list}</ul><p style="margin-top:20px;padding:12px;border-radius:8px;background:#fff7ed;color:#9a3412"><strong>TESTOVACÍ VZORY</strong> · dokumenty nejsou nabídkou, objednávkou ani potvrzením skutečného předání.</p></main><p style="text-align:center;color:#98a2b3;font-size:12px">EKV Project s.r.o. · info@ekvproject.cz</p></div></body></html>`;
    const sent = await sendTrackedEmail({
      admin, resendApiKey, from: Deno.env.get('RESEND_FROM_EMAIL') || 'EKV Project <portal@web.ekvproject.cz>',
      to: ['info@ekvproject.cz'], subject: '[TEST] EKV firemní dokumenty · sada ke kontrole vzhledu', html,
      attachments, idempotencyKey, workflowType: 'document_lookbook', entityType: 'document_template', eventType: 'test',
      metadata: { attachmentCount: attachments.length, files: names, totalBytes },
    });
    return json({ success: true, recipient: 'info@ekvproject.cz', files: names, ...sent });
  } catch (error) {
    console.error('[send-document-lookbook]', error);
    return json({ error: error?.message || 'Odeslání testovací sady se nepodařilo.' }, error?.status || 500);
  }
});
