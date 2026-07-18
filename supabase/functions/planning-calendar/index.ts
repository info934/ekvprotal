import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0';
import { corsHeaders } from '../_shared/cors.ts';

type CalendarAction = 'checkAvailability' | 'syncItem' | 'testConnection';

type PlanningItem = {
  id: string;
  plan_id: string;
  name: string;
  description?: string | null;
  start_date: string;
  end_date: string;
  status: string;
  calendar_sync_enabled: boolean;
  member_id?: string | null;
  member?: {
    id: string;
    name?: string | null;
    email?: string | null;
    microsoft_calendar_email?: string | null;
    microsoft_calendar_enabled?: boolean;
  } | null;
};

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const TIMEZONE = 'Europe/Prague';

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

const graphError = async (response: Response) => {
  const payload = await response.json().catch(() => ({}));
  const error = new Error(payload?.error?.message || `Microsoft Graph returned ${response.status}.`) as Error & { status?: number; code?: string };
  error.status = response.status;
  error.code = payload?.error?.code;
  return error;
};

const getGraphToken = async () => {
  const tenantId = Deno.env.get('MS_GRAPH_TENANT_ID');
  const clientId = Deno.env.get('MS_GRAPH_CLIENT_ID');
  const clientSecret = Deno.env.get('MS_GRAPH_CLIENT_SECRET');
  if (!tenantId || !clientId || !clientSecret) throw new Error('Microsoft Graph credentials are not configured.');

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  if (!response.ok) throw await graphError(response);
  const payload = await response.json();
  return String(payload.access_token);
};

const getTokenRoles = (token: string) => {
  try {
    const encoded = token.split('.')[1];
    const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(atob(normalized));
    return Array.isArray(payload.roles) ? payload.roles.map(String) : [];
  } catch {
    return [];
  }
};

const graphFetch = async (token: string, path: string, init: RequestInit = {}) => {
  const response = await fetch(`${GRAPH_ROOT}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  if (!response.ok) throw await graphError(response);
  if (response.status === 204) return null;
  return response.json();
};

const escapeHtml = (value: unknown) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const resolveMailbox = (item: PlanningItem) => {
  if (!item.member_id || !item.member) throw new Error('Calendar synchronization requires an assigned employee.');
  if (item.member.microsoft_calendar_enabled === false) throw new Error('Microsoft calendar is disabled for the assigned employee.');
  const mailbox = String(item.member.microsoft_calendar_email || item.member.email || '').trim().toLowerCase();
  if (!mailbox) throw new Error('The assigned employee does not have a Microsoft calendar email.');
  return mailbox;
};

const eventPayload = (item: PlanningItem, siteUrl: string) => ({
  subject: `[EKV] ${item.name}`,
  body: {
    contentType: 'HTML',
    content: [
      `<p><strong>${escapeHtml(item.name)}</strong></p>`,
      item.description ? `<p>${escapeHtml(item.description).replaceAll('\n', '<br>')}</p>` : '',
      `<p><a href="${escapeHtml(`${siteUrl}/planning`)}">Otevřít plán v EKVPortal</a></p>`,
    ].join(''),
  },
  start: { dateTime: `${item.start_date}T00:00:00`, timeZone: TIMEZONE },
  end: { dateTime: `${addDays(item.end_date, 1)}T00:00:00`, timeZone: TIMEZONE },
  isAllDay: true,
  showAs: item.status === 'cancelled' ? 'free' : 'busy',
  sensitivity: 'normal',
  categories: ['EKVPortal'],
  transactionId: item.id,
});

const writeLog = async (admin: ReturnType<typeof createClient>, values: Record<string, unknown>) => {
  const { error } = await admin.from('planning_calendar_sync_log').insert(values);
  if (error) console.error('[planning-calendar] log insert failed', error);
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let logContext: Record<string, unknown> = {};
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !serviceRoleKey || !anonKey) throw new Error('Missing Supabase service configuration.');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ success: false, error: 'Missing authorization.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const authenticated = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return jsonResponse({ success: false, error: 'Invalid session.' }, 401);

    const body = await req.json();
    const action = body.action as CalendarAction;
    if (!action) return jsonResponse({ success: false, error: 'Missing action.' }, 400);

    const { data: memberRecord } = await admin.from('members').select('user_role').eq('auth_user_id', user.id).maybeSingle();
    const isAdmin = memberRecord?.user_role === 'admin';

    if (action === 'testConnection') {
      if (!isAdmin) return jsonResponse({ success: false, error: 'Admin role required.' }, 403);
      const graphToken = await getGraphToken();
      const roles = getTokenRoles(graphToken);
      if (!roles.includes('Calendars.ReadWrite')) {
        return jsonResponse({
          success: false,
          error: 'Microsoft Graph application permission Calendars.ReadWrite is missing or admin consent was not granted.',
          roles,
        }, 403);
      }
      const mailbox = String(body.mailbox || user.email || '').trim().toLowerCase();
      if (!mailbox) return jsonResponse({ success: false, error: 'A mailbox is required for the connection test.' }, 400);
      const calendar = await graphFetch(graphToken, `/users/${encodeURIComponent(mailbox)}/calendar?$select=id,name`);
      return jsonResponse({ success: true, mailbox, calendar: { id: calendar.id, name: calendar.name }, roles });
    }

    if (!body.itemId) return jsonResponse({ success: false, error: 'Planning item is required.' }, 400);
    const { data: item, error: itemError } = await authenticated
      .from('planning_items')
      .select('id, plan_id, name, description, start_date, end_date, status, calendar_sync_enabled, member_id, member:members(id, name, email, microsoft_calendar_email, microsoft_calendar_enabled)')
      .eq('id', body.itemId)
      .single();
    if (itemError || !item) return jsonResponse({ success: false, error: 'Planning item was not found or is not accessible.' }, 404);

    const requiredPermission = action === 'syncItem' ? 'planning_can_edit_plan' : 'planning_can_read_plan';
    const { data: allowed, error: permissionError } = await authenticated.rpc(requiredPermission, { p_plan_id: item.plan_id });
    if (permissionError || !allowed) return jsonResponse({ success: false, error: 'Planning calendar access denied.' }, 403);

    const planningItem = item as unknown as PlanningItem;

    if (action === 'checkAvailability') {
      const mailbox = resolveMailbox(planningItem);
      const graphToken = await getGraphToken();
      logContext = { plan_id: item.plan_id, item_id: item.id, member_id: item.member_id, actor_user_id: user.id, mailbox_address: mailbox };
      const schedule = await graphFetch(graphToken, `/users/${encodeURIComponent(mailbox)}/calendar/getSchedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: `outlook.timezone="${TIMEZONE}"` },
        body: JSON.stringify({
          schedules: [mailbox],
          startTime: { dateTime: `${item.start_date}T00:00:00`, timeZone: TIMEZONE },
          endTime: { dateTime: `${addDays(item.end_date, 1)}T00:00:00`, timeZone: TIMEZONE },
          availabilityViewInterval: 60,
        }),
      });
      const result = schedule.value?.[0] || {};
      const conflicts = (result.scheduleItems || []).filter((entry: { status?: string }) => !['free', 'unknown'].includes(String(entry.status || '').toLowerCase()));
      await writeLog(admin, { ...logContext, action: 'availability_check', status: 'success', details: { conflict_count: conflicts.length } });
      return jsonResponse({ success: true, available: conflicts.length === 0, conflicts, availabilityView: result.availabilityView || '' });
    }

    const { data: existingLink } = await admin.from('planning_calendar_links').select('*').eq('item_id', item.id).maybeSingle();
    const queueUpdate = async (status: string, error: string | null = null) => admin
      .from('planning_calendar_sync_queue')
      .update({ status, last_error: error, completed_at: status === 'completed' ? new Date().toISOString() : null })
      .eq('item_id', item.id)
      .in('status', ['pending', 'processing', 'failed']);

    if (!item.calendar_sync_enabled || item.status === 'cancelled') {
      const mailbox = existingLink?.mailbox_address || null;
      if (existingLink?.external_event_id) {
        const graphToken = await getGraphToken();
        await graphFetch(graphToken, `/users/${encodeURIComponent(existingLink.mailbox_address)}/events/${encodeURIComponent(existingLink.external_event_id)}`, { method: 'DELETE' });
      }
      if (mailbox) {
        await admin.from('planning_calendar_links').upsert({
          item_id: item.id,
          member_id: item.member_id,
          mailbox_address: mailbox,
          external_event_id: null,
          external_change_key: null,
          web_link: null,
          sync_status: 'disabled',
          last_synced_at: new Date().toISOString(),
          last_error: null,
        }, { onConflict: 'item_id' });
      }
      await queueUpdate('completed');
      await writeLog(admin, {
        plan_id: item.plan_id,
        item_id: item.id,
        member_id: item.member_id,
        actor_user_id: user.id,
        mailbox_address: mailbox,
        action: existingLink?.external_event_id ? 'delete' : 'disable',
        status: 'success',
        external_event_id: existingLink?.external_event_id || null,
      });
      return jsonResponse({ success: true, status: 'disabled' });
    }

    const mailbox = resolveMailbox(planningItem);
    const graphToken = await getGraphToken();
    logContext = { plan_id: item.plan_id, item_id: item.id, member_id: item.member_id, actor_user_id: user.id, mailbox_address: mailbox };
    const payload = eventPayload(planningItem, Deno.env.get('SITE_URL') || 'https://portal.ekvproject.cz');
    let event;
    let eventAction = 'create';
    if (existingLink?.external_event_id && existingLink.mailbox_address === mailbox) {
      eventAction = 'update';
      event = await graphFetch(graphToken, `/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(existingLink.external_event_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      if (existingLink?.external_event_id && existingLink.mailbox_address !== mailbox) {
        await graphFetch(graphToken, `/users/${encodeURIComponent(existingLink.mailbox_address)}/events/${encodeURIComponent(existingLink.external_event_id)}`, { method: 'DELETE' });
      }
      event = await graphFetch(graphToken, `/users/${encodeURIComponent(mailbox)}/calendar/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    await admin.from('planning_calendar_links').upsert({
      item_id: item.id,
      member_id: item.member_id,
      mailbox_address: mailbox,
      external_event_id: event.id,
      external_change_key: event.changeKey || null,
      web_link: event.webLink || null,
      sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
      last_error: null,
    }, { onConflict: 'item_id' });
    await queueUpdate('completed');
    await writeLog(admin, { ...logContext, action: eventAction, status: 'success', external_event_id: event.id });
    return jsonResponse({ success: true, status: 'synced', eventId: event.id, webLink: event.webLink || null });
  } catch (error) {
    console.error('[planning-calendar]', error);
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && serviceRoleKey && logContext.item_id) {
        const admin = createClient(supabaseUrl, serviceRoleKey);
        const message = error instanceof Error ? error.message : 'Unexpected calendar error.';
        await admin.from('planning_calendar_links').update({ sync_status: 'error', last_error: message }).eq('item_id', logContext.item_id);
        await admin.from('planning_calendar_sync_queue').update({ status: 'failed', last_error: message }).eq('item_id', logContext.item_id).in('status', ['pending', 'processing', 'failed']);
        await writeLog(admin, { ...logContext, action: 'sync', status: 'error', details: { message } });
      }
    } catch (logError) {
      console.error('[planning-calendar] error logging failed', logError);
    }
    return jsonResponse({ success: false, error: error instanceof Error ? error.message : 'Unexpected calendar error.' }, (error as { status?: number }).status || 500);
  }
});
