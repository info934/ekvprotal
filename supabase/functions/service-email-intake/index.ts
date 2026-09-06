import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0';
import { corsHeaders } from '../_shared/cors.ts';
import { authorizeFunctionRequest } from '../_shared/authorize.ts';
import { fetchWithTimeout } from '../_shared/fetch.ts';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf', 'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

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
  if (!tenantId || !clientId || !clientSecret) throw new Error('Microsoft Graph není nakonfigurovaný.');
  const response = await fetchWithTimeout(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
  });
  if (!response.ok) throw await graphError(response);
  return String((await response.json()).access_token || '');
};

const tokenRoles = (token: string) => {
  try {
    const encoded = token.split('.')[1];
    const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(atob(normalized));
    return Array.isArray(payload.roles) ? payload.roles.map(String) : [];
  } catch { return []; }
};

const graphJson = async (token: string, path: string) => {
  const response = await fetchWithTimeout(`${GRAPH_ROOT}${path}`, { headers: { Authorization: `Bearer ${token}` } }, 30_000);
  if (!response.ok) throw await graphError(response);
  return response.json();
};

const graphBytes = async (token: string, path: string) => {
  const response = await fetchWithTimeout(`${GRAPH_ROOT}${path}`, { headers: { Authorization: `Bearer ${token}` } }, 30_000);
  if (!response.ok) throw await graphError(response);
  return new Uint8Array(await response.arrayBuffer());
};

const decodeBase64 = (value: string) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const htmlToText = (value: string) => value
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();

const safeFileName = (value: string, fallback: string) => {
  const normalized = String(value || '').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, 180);
};

const emailAddress = (recipient: any) => String(recipient?.emailAddress?.address || '').trim().toLowerCase();
const recipientList = (items: any[]) => (Array.isArray(items) ? items : []).map((item) => ({
  name: String(item?.emailAddress?.name || '').trim() || null,
  email: emailAddress(item),
})).filter((item) => item.email);

const getSettings = async (admin: ReturnType<typeof createClient>) => {
  const { data, error } = await admin.from('app_settings').select('key,value')
    .in('key', ['service_inbox_enabled', 'service_inbox_mailbox']);
  if (error) throw error;
  const values = Object.fromEntries((data || []).map(({ key, value }) => [key, value]));
  return {
    enabled: String(values.service_inbox_enabled || 'true').toLowerCase() === 'true',
    mailbox: String(values.service_inbox_mailbox || 'service@ekvproject.cz').trim().toLowerCase(),
  };
};

const suggestedLinks = async (admin: ReturnType<typeof createClient>, senderEmail: string) => {
  const { data: subject } = await admin.from('subjects').select('id').ilike('email', senderEmail).limit(1).maybeSingle();
  if (!subject?.id) return {};
  const [opportunity, realization, project] = await Promise.all([
    admin.from('crm_opportunities').select('id').eq('subject_id', subject.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('realizations').select('id').eq('investor_id', subject.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('projects').select('id').or(`client_id.eq.${subject.id},investor_id.eq.${subject.id}`).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    suggested_subject_id: subject.id,
    suggested_opportunity_id: opportunity.data?.id || null,
    suggested_realizace_id: realization.data?.id || null,
    suggested_project_id: project.data?.id || null,
  };
};

const saveAttachments = async (
  admin: ReturnType<typeof createClient>, token: string, mailbox: string, message: any, ticketId: string,
) => {
  if (!message.hasAttachments) return { saved: 0, skipped: 0 };
  const path = `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(message.id)}/attachments?$top=100`;
  const payload = await graphJson(token, path);
  let saved = 0;
  let skipped = 0;
  for (const attachment of payload.value || []) {
    if (attachment['@odata.type'] !== '#microsoft.graph.fileAttachment') { skipped += 1; continue; }
    const mimeType = String(attachment.contentType || 'application/octet-stream').toLowerCase();
    const size = Number(attachment.size || 0);
    if (!ALLOWED_MIME_TYPES.has(mimeType) || size <= 0 || size > MAX_ATTACHMENT_BYTES) { skipped += 1; continue; }
    let bytes = attachment.contentBytes ? decodeBase64(String(attachment.contentBytes)) : null;
    if (!bytes?.byteLength) {
      bytes = await graphBytes(token, `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.id)}/$value`);
    }
    if (!bytes.byteLength || bytes.byteLength > MAX_ATTACHMENT_BYTES) { skipped += 1; continue; }
    const fileName = safeFileName(attachment.name, `priloha-${saved + 1}`);
    const storagePath = `${ticketId}/${String(attachment.id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}-${fileName}`;
    const { error: uploadError } = await admin.storage.from('service-inbox').upload(storagePath, bytes, { contentType: mimeType, upsert: false });
    if (uploadError && !/already exists/i.test(uploadError.message)) throw uploadError;
    const { error: rowError } = await admin.from('service_ticket_attachments').upsert({
      service_ticket_id: ticketId, provider_attachment_id: String(attachment.id), file_name: fileName,
      storage_path: storagePath, mime_type: mimeType, size_bytes: bytes.byteLength,
      is_inline: Boolean(attachment.isInline), content_id: attachment.contentId || null,
    }, { onConflict: 'service_ticket_id,provider_attachment_id', ignoreDuplicates: true });
    if (rowError) throw rowError;
    saved += 1;
  }
  return { saved, skipped };
};

const processMailbox = async (admin: ReturnType<typeof createClient>, token: string, mailbox: string) => {
  const { data: state } = await admin.from('service_inbox_state').select('last_synced_at').eq('mailbox_address', mailbox).maybeSingle();
  const previous = state?.last_synced_at ? new Date(state.last_synced_at).getTime() : Date.now() - 24 * 60 * 60 * 1000;
  const since = new Date(Math.max(previous - 10 * 60 * 1000, Date.now() - 7 * 24 * 60 * 60 * 1000)).toISOString();
  const query = new URLSearchParams({
    '$filter': `receivedDateTime ge ${since}`,
    '$select': 'id,internetMessageId,receivedDateTime,subject,from,toRecipients,ccRecipients,body,bodyPreview,hasAttachments',
    '$orderby': 'receivedDateTime asc', '$top': '100',
  });
  const messages = await graphJson(token, `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?${query.toString()}`);
  let created = 0;
  let duplicates = 0;
  let attachments = 0;
  let skippedAttachments = 0;
  let newest = state?.last_synced_at || since;
  for (const message of messages.value || []) {
    const senderEmail = emailAddress(message.from);
    if (!senderEmail) continue;
    const bodyHtml = String(message.body?.contentType || '').toLowerCase() === 'html' ? String(message.body?.content || '') : '';
    const bodyText = bodyHtml ? htmlToText(bodyHtml) : String(message.body?.content || message.bodyPreview || '').trim();
    const suggestions = await suggestedLinks(admin, senderEmail);
    const ticketPayload = {
      provider: 'microsoft_graph', provider_message_id: String(message.id), internet_message_id: message.internetMessageId || null,
      mailbox_address: mailbox, sender_name: String(message.from?.emailAddress?.name || '').trim() || null,
      sender_email: senderEmail, recipients: recipientList(message.toRecipients), cc_recipients: recipientList(message.ccRecipients),
      subject: String(message.subject || '(bez předmětu)'), body_text: bodyText, body_html: bodyHtml || null,
      received_at: message.receivedDateTime, attachment_count: message.hasAttachments ? 1 : 0, ...suggestions,
    };
    const { data: ticket, error } = await admin.rpc('create_service_ticket_from_email', { p_payload: ticketPayload });
    if (error) {
      if (error.code === '23505') { duplicates += 1; }
      else throw error;
    } else if (ticket?.id) {
      created += 1;
      const result = await saveAttachments(admin, token, mailbox, message, ticket.id);
      attachments += result.saved;
      skippedAttachments += result.skipped;
      await admin.from('service_tickets').update({ attachment_count: result.saved }).eq('id', ticket.id);
    }
    if (message.receivedDateTime && new Date(message.receivedDateTime) > new Date(newest)) newest = message.receivedDateTime;
  }
  const result = { mailbox, examined: (messages.value || []).length, created, duplicates, attachments, skippedAttachments };
  await admin.from('service_inbox_state').upsert({
    mailbox_address: mailbox, last_synced_at: newest, last_success_at: new Date().toISOString(), last_error: null, last_result: result,
  });
  return result;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const admin = createClient(supabaseUrl, serviceRoleKey);
  let mailbox = '';
  try {
    const body = await req.json().catch(() => ({}));
    const cronSecret = req.headers.get('x-service-inbox-secret');
    if (cronSecret) {
      const { data: valid, error } = await admin.rpc('verify_service_email_intake_secret', { p_secret: cronSecret });
      if (error || !valid) return json({ success: false, error: 'Invalid scheduler authentication.' }, 401);
    } else {
      await authorizeFunctionRequest(req, { adminOnly: true });
    }
    const settings = await getSettings(admin);
    mailbox = settings.mailbox;
    if (!mailbox || !mailbox.includes('@')) return json({ success: false, error: 'Nastavte platnou servisní schránku.' }, 400);
    if (!settings.enabled && body.action !== 'test') return json({ success: true, disabled: true, mailbox });

    const token = await getGraphToken();
    const roles = tokenRoles(token);
    if (!roles.includes('Mail.Read')) {
      throw Object.assign(new Error('Aplikaci Microsoft Graph chybí oprávnění Mail.Read (Application) se souhlasem administrátora.'), { status: 403, roles });
    }
    const inbox = await graphJson(token, `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox?$select=id,displayName,totalItemCount,unreadItemCount`);
    if (body.action === 'test') return json({ success: true, mailbox, inbox, roles });
    const result = await processMailbox(admin, token, mailbox);
    return json({ success: true, ...result });
  } catch (error) {
    console.error('[service-email-intake]', error);
    if (mailbox) await admin.from('service_inbox_state').upsert({
      mailbox_address: mailbox, last_error: error?.message || 'Synchronizace selhala.', last_result: { failedAt: new Date().toISOString() },
    });
    return json({ success: false, error: error?.message || 'Příjem servisních e-mailů selhal.', roles: error?.roles || undefined }, error?.status || 500);
  }
});
