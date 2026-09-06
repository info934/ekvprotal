import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWithTimeout } from '../_shared/fetch.ts';
import { authorizeFunctionRequest } from '../_shared/authorize.ts';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const escapeHtml = (value: unknown) => String(value || '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const graphError = async (response: Response) => {
  const payload = await response.json().catch(() => ({}));
  const error = new Error(payload?.error?.message || `Microsoft Graph returned ${response.status}.`) as Error & { status?: number };
  error.status = response.status;
  return error;
};

const graphToken = async () => {
  const tenantId = Deno.env.get('MS_GRAPH_TENANT_ID');
  const clientId = Deno.env.get('MS_GRAPH_CLIENT_ID');
  const clientSecret = Deno.env.get('MS_GRAPH_CLIENT_SECRET');
  if (!tenantId || !clientId || !clientSecret) throw new Error('Microsoft 365 calendar is not configured.');
  const response = await fetchWithTimeout(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
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
  return String((await response.json()).access_token || '');
};

const graphFetch = async (token: string, path: string, init: RequestInit = {}) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchWithTimeout(`${GRAPH_ROOT}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
    if (response.ok) return response.status === 204 ? null : response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : 750 * (2 ** attempt)));
      continue;
    }
    throw await graphError(response);
  }
  throw new Error('Microsoft Graph retry limit exceeded.');
};

const eventTime = (value: string) => ({
  dateTime: new Date(value).toISOString().replace(/Z$/, ''),
  timeZone: 'UTC',
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let admin: ReturnType<typeof createClient> | null = null;
  let requestedActivityId: string | null = null;
  try {
    if (req.method !== 'POST') return respond({ success: false, error: 'Method not allowed.' }, 405);
    const actor = await authorizeFunctionRequest(req, { module: 'crm', level: 'edit' });
    const { action = 'sync', activityId } = await req.json();
    requestedActivityId = activityId || null;
    if (!activityId || !['sync', 'delete'].includes(action)) return respond({ success: false, error: 'Invalid request.' }, 400);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const siteUrl = (Deno.env.get('SITE_URL') || 'https://portal.ekvproject.cz').replace(/\/$/, '');
    admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: activity, error: activityError } = await admin.from('crm_activities')
      .select('id, opportunity_id, assigned_member_id, type, status, title, description, starts_at, ends_at, location, attendees, calendar_sync_enabled, external_mailbox, external_event_id, opportunity:opportunity_id(id, number, title)')
      .eq('id', activityId).maybeSingle();
    if (activityError || !activity) return respond({ success: false, error: 'CRM activity was not found.' }, 404);

    const token = await graphToken();
    const removeExisting = async () => {
      if (activity.external_event_id && activity.external_mailbox) {
        try {
          await graphFetch(token, `/users/${encodeURIComponent(activity.external_mailbox)}/events/${encodeURIComponent(activity.external_event_id)}`, { method: 'DELETE' });
        } catch (error) {
          if (Number(error?.status) !== 404) throw error;
        }
      }
      await admin.from('crm_activities').update({
        external_mailbox: null,
        external_event_id: null,
        external_web_link: null,
        calendar_synced_at: new Date().toISOString(),
        calendar_sync_error: null,
        calendar_sync_attempt_count: 0,
        calendar_next_retry_at: null,
      }).eq('id', activity.id);
    };

    if (action === 'delete' || activity.type !== 'meeting' || !activity.calendar_sync_enabled || activity.status === 'cancelled') {
      await removeExisting();
      await admin.from('crm_activity_events').insert({
        activity_id: activity.id,
        event_type: 'calendar_removed',
        actor_member_id: actor.memberId,
        snapshot: { external_event_id: activity.external_event_id },
      });
      return respond({ success: true, removed: true });
    }

    if (!activity.assigned_member_id || !activity.starts_at || !activity.ends_at) {
      return respond({ success: false, error: 'Meeting requires an assigned employee, start and end.' }, 400);
    }
    if (new Date(activity.ends_at) <= new Date(activity.starts_at)) {
      return respond({ success: false, error: 'Meeting end must be after its start.' }, 400);
    }

    const { data: member, error: memberError } = await admin.from('members')
      .select('id, name, email, microsoft_calendar_email, microsoft_calendar_enabled')
      .eq('id', activity.assigned_member_id).maybeSingle();
    if (memberError || !member) return respond({ success: false, error: 'Assigned employee was not found.' }, 400);
    if (member.microsoft_calendar_enabled === false) return respond({ success: false, error: 'Microsoft calendar is disabled for this employee.' }, 400);
    const mailbox = String(member.microsoft_calendar_email || member.email || '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(mailbox)) return respond({ success: false, error: 'Assigned employee does not have a valid Microsoft calendar address.' }, 400);

    const attendees = (Array.isArray(activity.attendees) ? activity.attendees : [])
      .map((entry) => String(entry?.email || entry?.address || '').trim().toLowerCase())
      .filter((email, index, values) => EMAIL_PATTERN.test(email) && values.indexOf(email) === index && email !== mailbox)
      .slice(0, 50)
      .map((email) => ({ emailAddress: { address: email }, type: 'required' }));
    const portalLink = `${siteUrl}/crm/opportunities/${encodeURIComponent(activity.opportunity_id)}`;
    const payload = {
      subject: `[EKV] ${activity.title}`,
      body: {
        contentType: 'HTML',
        content: [
          `<p><strong>${escapeHtml(activity.title)}</strong></p>`,
          activity.description ? `<p>${escapeHtml(activity.description).replaceAll('\n', '<br>')}</p>` : '',
          `<p><strong>Obchodní případ:</strong> ${escapeHtml(activity.opportunity?.number || '')} ${escapeHtml(activity.opportunity?.title || '')}</p>`,
          `<p><a href="${escapeHtml(portalLink)}">Otevřít obchodní případ v EKV Portálu</a></p>`,
        ].join(''),
      },
      start: eventTime(activity.starts_at),
      end: eventTime(activity.ends_at),
      location: activity.location ? { displayName: activity.location } : undefined,
      attendees,
      categories: ['EKV Portal', 'CRM'],
      showAs: 'busy',
      sensitivity: 'normal',
      transactionId: activity.id,
    };

    let event;
    if (activity.external_event_id && activity.external_mailbox === mailbox) {
      event = await graphFetch(token, `/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(activity.external_event_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!event) event = await graphFetch(token, `/users/${encodeURIComponent(mailbox)}/events/${encodeURIComponent(activity.external_event_id)}?$select=id,webLink`);
    } else {
      if (activity.external_event_id && activity.external_mailbox) await removeExisting();
      event = await graphFetch(token, `/users/${encodeURIComponent(mailbox)}/calendar/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    const syncedAt = new Date().toISOString();
    const { error: updateError } = await admin.from('crm_activities').update({
      external_mailbox: mailbox,
      external_event_id: event.id,
      external_web_link: event.webLink || null,
      calendar_synced_at: syncedAt,
      calendar_sync_error: null,
      calendar_sync_attempt_count: 0,
      calendar_next_retry_at: null,
    }).eq('id', activity.id);
    if (updateError) throw updateError;
    await admin.from('crm_activity_events').insert({
      activity_id: activity.id,
      event_type: 'calendar_synced',
      actor_member_id: actor.memberId,
      snapshot: { mailbox, external_event_id: event.id, attendee_count: attendees.length, synced_at: syncedAt },
    });
    return respond({ success: true, eventId: event.id, webLink: event.webLink || null, attendeeCount: attendees.length });
  } catch (error) {
    console.error('[crm-activity-calendar]', error);
    if (admin && requestedActivityId) {
      const { data: failed } = await admin.from('crm_activities')
        .select('calendar_sync_attempt_count').eq('id', requestedActivityId).maybeSingle();
      const attempts = Number(failed?.calendar_sync_attempt_count || 0) + 1;
      const retryMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
      await admin.from('crm_activities').update({
        calendar_sync_error: error instanceof Error ? error.message : 'Calendar synchronization failed.',
        calendar_sync_attempt_count: attempts,
        calendar_next_retry_at: new Date(Date.now() + retryMinutes * 60000).toISOString(),
      }).eq('id', requestedActivityId);
    }
    const status = Number(error?.status || 500);
    return respond({ success: false, error: status >= 500 ? 'Calendar synchronization failed.' : (error instanceof Error ? error.message : 'Calendar synchronization failed.') }, status);
  }
});
