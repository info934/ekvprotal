import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { authorizeFunctionRequest } from '../_shared/authorize.ts';
import { sendTrackedEmail } from '../_shared/emailDelivery.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] || char));
const emailOk = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const PORTAL_URL = (Deno.env.get('PORTAL_URL') || Deno.env.get('PORTAL_PUBLIC_URL') || 'https://portal.ekvproject.cz').replace(/\/$/, '');
const TIME_ZONE = 'Europe/Prague';
const conditionLabels: Record<string, string> = {
  handover: 'Po předání díla', warranty: 'Po skončení záruční doby', custom: 'Sjednaná podmínka',
};
const statusLabels: Record<string, string> = { planned: 'Plánováno', requested: 'Vyžádáno' };
const money = (value: number) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(value);
const dateLabel = (value: unknown) => value
  ? new Intl.DateTimeFormat('cs-CZ', { timeZone: TIME_ZONE, dateStyle: 'medium' }).format(new Date(String(value)))
  : 'Termín neurčen';
const pragueParts = (now = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
}).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));

const loadSettings = async (admin: any) => {
  const { data, error } = await admin.from('app_settings').select('key,value').in('key', [
    'realization_retention_summary_enabled', 'realization_retention_summary_recipient',
  ]);
  if (error) throw error;
  const values = Object.fromEntries((data || []).map((row: any) => [row.key, row.value]));
  return {
    enabled: String(values.realization_retention_summary_enabled || 'true').toLowerCase() === 'true',
    recipient: String(values.realization_retention_summary_recipient || 'info@ekvproject.cz').trim().toLowerCase(),
  };
};

const loadItems = async (admin: any) => {
  const rows: any[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin.from('realization_retentions')
      .select('id,label,percentage,release_condition,notification_at,status,note,realization:realization_id!inner(id,code,name,contract_amount,retention_enabled)')
      .in('status', ['planned', 'requested']).order('notification_at', { ascending: true, nullsFirst: false }).range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []).filter((item: any) => item.realization?.retention_enabled));
    if ((data || []).length < pageSize) break;
  }
  return rows;
};

const buildEmail = (items: any[], test: boolean, now: Date) => {
  const nowTime = now.getTime();
  const next30 = nowTime + 30 * 86_400_000;
  const amount = (item: any) => Number(item.realization?.contract_amount || 0) * Number(item.percentage || 0) / 100;
  const knownItems = items.filter((item) => Number(item.realization?.contract_amount || 0) > 0);
  const total = knownItems.reduce((sum, item) => sum + amount(item), 0);
  const overdue = items.filter((item) => item.notification_at && new Date(item.notification_at).getTime() < nowTime);
  const dueSoon = items.filter((item) => {
    const time = item.notification_at ? new Date(item.notification_at).getTime() : 0;
    return time >= nowTime && time <= next30;
  });
  const withoutDate = items.filter((item) => !item.notification_at);
  const rows = items.map((item) => {
    const realization = item.realization || {};
    const itemAmount = Number(realization.contract_amount || 0) > 0 ? money(amount(item)) : 'Chybí smluvní cena';
    const link = `${PORTAL_URL}/realizace/${encodeURIComponent(realization.id)}#finance`;
    const dueTime = item.notification_at ? new Date(item.notification_at).getTime() : null;
    const dueTone = dueTime && dueTime < nowTime ? '#b42318' : dueTime && dueTime <= next30 ? '#b54708' : '#344054';
    return `<tr><td style="padding:11px;border-bottom:1px solid #eaecf0"><a href="${link}" style="color:#175cd3;font-weight:700;text-decoration:none">${escapeHtml(realization.code || 'Realizace')}</a><br><span style="color:#667085">${escapeHtml(realization.name || '')}</span></td><td style="padding:11px;border-bottom:1px solid #eaecf0">${escapeHtml(item.label)}<br><span style="color:#667085">${escapeHtml(conditionLabels[item.release_condition] || 'Sjednaná podmínka')}</span></td><td style="padding:11px;border-bottom:1px solid #eaecf0;text-align:right;white-space:nowrap"><strong>${escapeHtml(itemAmount)}</strong><br><span style="color:#667085">${Number(item.percentage || 0).toLocaleString('cs-CZ')} %</span></td><td style="padding:11px;border-bottom:1px solid #eaecf0;color:${dueTone};white-space:nowrap"><strong>${escapeHtml(dateLabel(item.notification_at))}</strong><br><span>${escapeHtml(statusLabels[item.status] || item.status)}</span></td></tr>`;
  }).join('');
  const reportDate = new Intl.DateTimeFormat('cs-CZ', { timeZone: TIME_ZONE, dateStyle: 'long' }).format(now);
  const empty = '<tr><td colspan="4" style="padding:24px;text-align:center;color:#667085">Není evidováno žádné aktivní zádržné.</td></tr>';
  const banner = test ? '<div style="margin-bottom:16px;padding:12px 14px;border-radius:8px;background:#fff7ed;color:#9a3412;font-weight:700">TESTOVACÍ PŘEHLED · používá aktuální data portálu.</div>' : '';
  return `<!doctype html><html lang="cs"><body style="margin:0;background:#eef2f7;font-family:Arial,sans-serif;color:#101828"><div style="max-width:920px;margin:auto;padding:28px 14px"><div style="height:6px;border-radius:999px;background:linear-gradient(90deg,#153b82,#2459c7,#2f8f5b)"></div><main style="margin-top:10px;padding:26px;border:1px solid #d7e0ec;border-radius:14px;background:#fff">${banner}<div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#2459c7">EKV PROJECT · FINANCE REALIZACÍ</div><h1 style="margin:10px 0 8px;font-size:25px">Měsíční přehled zádržného</h1><p style="margin:0;color:#475467">Stav k ${escapeHtml(reportDate)}. Aktivní jsou plánované a již vyžádané položky, které dosud nejsou označené jako vyplacené.</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin:20px 0"><div style="flex:1;min-width:150px;padding:14px;border-radius:10px;background:#eff6ff"><b style="font-size:22px">${items.length}</b><br><span>aktivních položek</span></div><div style="flex:1;min-width:150px;padding:14px;border-radius:10px;background:#fef2f2"><b style="font-size:22px;color:#b42318">${overdue.length}</b><br><span>po termínu</span></div><div style="flex:1;min-width:150px;padding:14px;border-radius:10px;background:#fff7ed"><b style="font-size:22px;color:#b54708">${dueSoon.length}</b><br><span>do 30 dnů</span></div><div style="flex:1;min-width:180px;padding:14px;border-radius:10px;background:#ecfdf3"><b style="font-size:22px;color:#067647">${money(total)}</b><br><span>známá částka${withoutDate.length ? ` · ${withoutDate.length} bez data` : ''}</span></div></div><div style="overflow-x:auto"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f8fafc"><th style="padding:11px;text-align:left">Realizace</th><th style="padding:11px;text-align:left">Část a podmínka</th><th style="padding:11px;text-align:right">Částka</th><th style="padding:11px;text-align:left">Termín a stav</th></tr></thead><tbody>${rows || empty}</tbody></table></div><p style="margin:22px 0 0"><a href="${PORTAL_URL}/realizace" style="display:inline-block;padding:12px 17px;border-radius:8px;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:700">Otevřít realizace v portálu</a></p><p style="margin:18px 0 0;color:#667085;font-size:12px">Částky se počítají jako procento ze smluvní ceny realizace. Pokud smluvní cena chybí, je položka v přehledu zřetelně označena.</p></main><p style="text-align:center;color:#98a2b3;font-size:12px">EKV Project s.r.o. · info@ekvproject.cz</p></div></body></html>`;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const test = body?.action === 'test';
    const scheduled = body?.action === 'scheduled';
    if (!test && !scheduled) return json({ error: 'Neplatná akce.' }, 400);
    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
    if (!url || !serviceKey || !resendApiKey) throw Object.assign(new Error('E-mailová služba není nakonfigurována.'), { status: 503 });
    const admin = createClient(url, serviceKey);
    let requestedBy: string | null = null;
    const suppliedSecret = req.headers.get('x-realization-retention-secret') || '';
    const { data: validCronSecret, error: secretError } = suppliedSecret
      ? await admin.rpc('verify_realization_retention_cron_secret', { p_secret: suppliedSecret })
      : { data: false, error: null };
    if (secretError) throw secretError;
    if (scheduled && !validCronSecret) return json({ error: 'Unauthorized scheduler.' }, 401);
    if (test && !validCronSecret) {
      const actor = await authorizeFunctionRequest(req, { adminOnly: true });
      requestedBy = actor.userId;
    }
    const settings = await loadSettings(admin);
    if (!emailOk(settings.recipient)) throw Object.assign(new Error('Příjemce měsíčního přehledu není platný.'), { status: 400 });
    if (scheduled && !settings.enabled) return json({ success: true, skipped: 'disabled' });
    const now = new Date();
    const parts = pragueParts(now);
    if (scheduled && (parts.day !== '01' || parts.hour !== '07')) return json({ success: true, skipped: 'outside_schedule_window' });
    const items = await loadItems(admin);
    const period = `${parts.year}-${parts.month}`;
    const sent = await sendTrackedEmail({
      admin, resendApiKey,
      from: Deno.env.get('RESEND_FROM_EMAIL') || 'EKV Project <portal@web.ekvproject.cz>',
      to: [settings.recipient],
      subject: `${test ? '[TEST] ' : ''}Měsíční přehled zádržného EKV · ${period}`,
      html: buildEmail(items, test, now),
      idempotencyKey: test ? `realization-retention-summary:test:${crypto.randomUUID()}` : `realization-retention-summary:${period}`,
      workflowType: 'realization_retention_summary', entityType: 'realization_retention', eventType: test ? 'test' : 'monthly', requestedBy,
      metadata: { period, timezone: TIME_ZONE, itemCount: items.length, test },
    });
    return json({ success: true, recipient: settings.recipient, period, itemCount: items.length, ...sent });
  } catch (error) {
    console.error('[send-realization-retention-summary]', error);
    return json({ error: error?.message || 'Odeslání přehledu zádržného se nepodařilo.' }, error?.status || 500);
  }
});
