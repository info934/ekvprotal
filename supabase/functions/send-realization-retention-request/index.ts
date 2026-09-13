import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { authorizeFunctionRequest } from '../_shared/authorize.ts';
import { sendTrackedEmail } from '../_shared/emailDelivery.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] || char));
const emailOk = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const PORTAL_URL = (Deno.env.get('PORTAL_URL') || 'https://portal.ekvproject.cz').replace(/\/$/, '');

const conditionLabel: Record<string, string> = {
  handover: 'po předání díla',
  warranty: 'po skončení záruční doby',
  custom: 'po splnění sjednané podmínky',
};
const money = (value: unknown) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency', currency: 'CZK', maximumFractionDigits: 2,
}).format(Number(value || 0));
const dateTime = (value: unknown) => value
  ? new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'long', timeStyle: 'short' }).format(new Date(String(value)))
  : 'ihned';

const emailHtml = (item: any) => {
  const realization = item.realization || {};
  const amount = Number(realization.contract_amount || 0) * Number(item.percentage || 0) / 100;
  const title = `Žádost o vyplacení zádržného`;
  const details = [
    ['Realizace', `${realization.code ? `${realization.code} · ` : ''}${realization.name || '—'}`],
    ['Část zádržného', item.label],
    ['Sazba', `${Number(item.percentage || 0).toLocaleString('cs-CZ')} %`],
    ['Předpokládaná částka', money(amount)],
    ['Podmínka', conditionLabel[item.release_condition] || 'sjednaná podmínka'],
    ['Naplánovaná žádost', dateTime(item.notification_at)],
  ].map(([label, value]) => `<tr><td style="padding:9px 12px;color:#667085;font-weight:700;vertical-align:top">${escapeHtml(label)}</td><td style="padding:9px 12px;color:#101828;vertical-align:top">${escapeHtml(value)}</td></tr>`).join('');
  const note = item.note ? `<p style="margin:20px 0 0;white-space:pre-wrap;color:#344054;line-height:1.6">${escapeHtml(item.note)}</p>` : '';
  const link = `${PORTAL_URL}/realizace/${encodeURIComponent(realization.id)}#finance`;
  return `<!doctype html><html lang="cs"><body style="margin:0;background:#eef2f7;font-family:Arial,sans-serif;color:#101828"><div style="max-width:680px;margin:auto;padding:28px 16px"><div style="height:6px;border-radius:999px;background:linear-gradient(90deg,#153b82,#2459c7,#2f8f5b)"></div><main style="margin-top:10px;padding:28px;border:1px solid #d7e0ec;border-radius:14px;background:#fff"><div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#2459c7">EKV PROJECT · REALIZACE</div><h1 style="margin:10px 0 12px;font-size:25px;line-height:1.25">${title}</h1><p style="margin:0;color:#475467;line-height:1.6">Evidujeme splnění termínu pro uvolnění níže uvedené části zádržného. Prosíme o prověření a zahájení vyplacení dle smluvních podmínek.</p><table role="presentation" style="width:100%;margin-top:20px;border-collapse:separate;border-spacing:0;border:1px solid #e4e7ec;border-radius:10px;overflow:hidden">${details}</table>${note}<p style="margin:24px 0 0"><a href="${link}" style="display:inline-block;padding:12px 17px;border-radius:8px;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:700">Otevřít realizaci v portálu</a></p></main><p style="text-align:center;color:#98a2b3;font-size:12px">EKV Project s.r.o. · info@ekvproject.cz</p></div></body></html>`;
};

const deliver = async (admin: any, item: any, requestedBy: string | null = null) => {
  const realization = item.realization || {};
  if (!item.recipient_email || !emailOk(item.recipient_email)) throw Object.assign(new Error('Příjemce žádosti o vyplacení není platný.'), { status: 400 });
  if (!realization.id) throw Object.assign(new Error('K zádržnému není přiřazena realizace.'), { status: 400 });
  const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
  if (!resendApiKey) throw Object.assign(new Error('E-mailová služba není nakonfigurována.'), { status: 503 });
  const sent = await sendTrackedEmail({
    admin,
    resendApiKey,
    from: Deno.env.get('RESEND_FROM_EMAIL') || 'EKV Project <portal@web.ekvproject.cz>',
    to: [item.recipient_email],
    subject: `Žádost o vyplacení zádržného · ${realization.code || realization.name || 'realizace'}`.slice(0, 180),
    html: emailHtml(item),
    idempotencyKey: `realization-retention-request:${item.id}`,
    workflowType: 'realization_retention',
    entityType: 'realization_retention',
    entityId: item.id,
    eventType: 'payment_request',
    requestedBy,
    metadata: { realizationId: realization.id, percentage: Number(item.percentage || 0), notificationAt: item.notification_at },
  });
  const { error } = await admin.from('realization_retentions')
    .update({ status: 'requested', requested_at: sent.sentAt || new Date().toISOString() })
    .eq('id', item.id).eq('status', 'planned');
  if (error) throw Object.assign(new Error('E-mail byl přijat, ale stav zádržného se nepodařilo uložit.'), { status: 503 });
  return sent;
};

const loadRetention = async (admin: any, id: string) => {
  const { data, error } = await admin.from('realization_retentions')
    .select('id,label,percentage,release_condition,notification_at,recipient_email,auto_request_enabled,status,note,realization:realization_id!inner(id,code,name,contract_amount,retention_enabled)')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const isScheduled = body?.action === 'scheduled';
    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!url || !serviceKey) throw Object.assign(new Error('Supabase configuration is missing.'), { status: 503 });
    const admin = createClient(url, serviceKey);

    if (isScheduled) {
      const suppliedSecret = req.headers.get('x-realization-retention-secret') || '';
      const { data: validSecret, error: secretError } = await admin.rpc('verify_realization_retention_cron_secret', { p_secret: suppliedSecret });
      if (secretError || !validSecret) return json({ error: 'Unauthorized scheduler.' }, 401);
      const { data: due, error } = await admin.from('realization_retentions')
        .select('id,label,percentage,release_condition,notification_at,recipient_email,auto_request_enabled,status,note,realization:realization_id!inner(id,code,name,contract_amount,retention_enabled)')
        .eq('auto_request_enabled', true).eq('status', 'planned').lte('notification_at', new Date().toISOString()).limit(100);
      if (error) throw error;
      let sent = 0; let failed = 0;
      for (const item of due || []) {
        if (!item.realization?.retention_enabled) continue;
        try { await deliver(admin, item); sent += 1; } catch (error) { failed += 1; console.error('[retention scheduled delivery]', item.id, error?.message || error); }
      }
      return json({ processed: (due || []).length, sent, failed });
    }

    const actor = await authorizeFunctionRequest(req, { adminOnly: true });
    const retentionId = String(body?.retentionId || '');
    if (!/^[0-9a-f-]{36}$/i.test(retentionId)) return json({ error: 'Neplatné zádržné.' }, 400);
    const item = await loadRetention(admin, retentionId);
    if (!item) return json({ error: 'Zádržné nebylo nalezeno.' }, 404);
    if (!item.realization?.retention_enabled) return json({ error: 'Evidence zádržného není pro realizaci aktivní.' }, 409);
    if (item.status !== 'planned') return json({ error: 'Žádost byla již odeslána nebo je položka uzavřená.' }, 409);
    const sent = await deliver(admin, item, actor.userId);
    return json({ success: true, ...sent });
  } catch (error) {
    console.error('[send-realization-retention-request]', error);
    return json({ error: error?.message || 'Odeslání žádosti o vyplacení se nepodařilo.' }, error?.status || 500);
  }
});
