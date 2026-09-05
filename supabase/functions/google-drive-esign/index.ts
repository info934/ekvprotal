import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWithTimeout } from '../_shared/fetch.ts';
import { assertActiveAccount } from '../_shared/accountStatus.ts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ROOT_FOLDER = 'EKVPortal-eSignature-POC';
const SIGNATURE_FOLDER = 'K podpisu';
const MAX_PDF_SIZE = 18 * 1024 * 1024;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const errorJson = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || 'Unexpected error.');
  let status = 500;
  let code = 'unexpected_error';

  const explicitStatus = error && typeof error === 'object' && 'status' in error ? Number(error.status) : null;
  if (explicitStatus === 403 || explicitStatus === 503) {
    status = explicitStatus;
    code = explicitStatus === 403 ? 'forbidden' : 'account_verification_unavailable';
  } else if (/Admin|Authentication|session|Not allowed/i.test(message)) {
    status = 403;
    code = 'forbidden';
  } else if (/not configured|not connected|není připojen|není nakonfigurován/i.test(message)) {
    status = 503;
    code = 'configuration_required';
  } else if (/Google Drive request failed/i.test(message)) {
    status = 502;
    code = 'google_drive_request_failed';
  } else if (/Protocol|PDF|signer|Unsupported|Unknown action|empty|exceeds/i.test(message)) {
    status = 400;
    code = 'invalid_request';
  }

  // Do not expose token values, request bodies, or provider secrets.
  return json({ success: false, error: message.slice(0, 500), code }, status);
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
};

const serviceClient = () => createClient(
  requiredEnv('SUPABASE_URL'),
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
};

const base64ToBytes = (value: string) => {
  const binary = atob(value.replace(/^data:application\/pdf;base64,/, ''));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const sha256 = async (value: string | Uint8Array) => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((item) => item.toString(16).padStart(2, '0')).join('');
};

const encryptionKey = async () => {
  const bytes = base64ToBytes(requiredEnv('GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY'));
  if (bytes.length !== 32) throw new Error('GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY must contain 32 bytes in base64.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
};

const encrypt = async (plainText: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    new TextEncoder().encode(plainText),
  ));
  const payload = new Uint8Array(iv.length + cipher.length);
  payload.set(iv);
  payload.set(cipher, iv.length);
  return bytesToBase64(payload);
};

const decrypt = async (encrypted: string) => {
  const payload = base64ToBytes(encrypted);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: payload.subarray(0, 12) },
    await encryptionKey(),
    payload.subarray(12),
  );
  return new TextDecoder().decode(plain);
};

const decryptStoredToken = async (encrypted: string) => {
  try {
    return await decrypt(encrypted);
  } catch {
    throw new Error('Uložené Google Drive připojení nelze odemknout. Propojte účet znovu v Nastavení > Úložiště.');
  }
};

const authenticateAdmin = async (req: Request) => {
  const authorization = req.headers.get('Authorization') || '';
  const jwt = authorization.replace(/^Bearer\s+/i, '');
  if (!jwt) throw new Error('Authentication required.');
  const db = serviceClient();
  const { data: authData, error: authError } = await db.auth.getUser(jwt);
  if (authError || !authData.user) throw new Error('Invalid session.');
  await assertActiveAccount(db, authData.user.id);
  const { data: member } = await db.from('members').select('user_role').eq('auth_user_id', authData.user.id).maybeSingle();
  if (member?.user_role !== 'admin') throw new Error('Admin access required.');
  return { db, user: authData.user };
};

const exchangeCode = async (code: string) => {
  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: requiredEnv('GOOGLE_DRIVE_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_DRIVE_CLIENT_SECRET'),
      redirect_uri: requiredEnv('GOOGLE_DRIVE_REDIRECT_URI'),
      grant_type: 'authorization_code',
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || 'Google OAuth token exchange failed.');
  return payload;
};

const refreshAccessToken = async (refreshToken: string) => {
  const response = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: requiredEnv('GOOGLE_DRIVE_CLIENT_ID'),
      client_secret: requiredEnv('GOOGLE_DRIVE_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error_description || 'Google token refresh failed.');
  return payload;
};

const activeAccessToken = async (db: ReturnType<typeof serviceClient>, userId: string) => {
  const { data: ownConnection, error: ownError } = await db
    .from('google_drive_oauth_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (ownError) throw ownError;

  let connection = ownConnection?.status === 'active' ? ownConnection : null;
  if (!connection) {
    const { data: organizationConnection, error: organizationError } = await db
      .from('google_drive_oauth_connections')
      .select('*')
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (organizationError) throw organizationError;
    connection = organizationConnection;
  }

  if (!connection) {
    throw new Error('Google Drive účet není připojen. Administrátor ho musí propojit v Nastavení > Úložiště.');
  }
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 60_000) {
    return { token: await decryptStoredToken(connection.encrypted_access_token), connection, shared: connection.user_id !== userId };
  }
  if (!connection.encrypted_refresh_token) {
    throw new Error('Platnost Google Drive připojení vypršela. Propojte účet znovu v Nastavení > Úložiště.');
  }
  const refreshed = await refreshAccessToken(await decryptStoredToken(connection.encrypted_refresh_token));
  const encryptedAccessToken = await encrypt(refreshed.access_token);
  const tokenExpiresAt = new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString();
  await db.from('google_drive_oauth_connections').update({
    encrypted_access_token: encryptedAccessToken,
    token_expires_at: tokenExpiresAt,
    status: 'active',
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id);
  return {
    token: refreshed.access_token,
    connection: { ...connection, token_expires_at: tokenExpiresAt },
    shared: connection.user_id !== userId,
  };
};

const driveRequest = async (token: string, path: string, init: RequestInit = {}) => {
  const response = await fetchWithTimeout(path.startsWith('http') ? path : `${DRIVE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Drive request failed (${response.status}): ${detail.slice(0, 400)}`);
  }
  return response;
};

const ensureFolder = async (token: string, name: string, parentId?: string) => {
  const safeName = name.replace(/'/g, "\\'");
  const clauses = [`name = '${safeName}'`, "mimeType = 'application/vnd.google-apps.folder'", 'trashed = false'];
  if (parentId) clauses.push(`'${parentId}' in parents`);
  const search = await driveRequest(token, `/files?q=${encodeURIComponent(clauses.join(' and '))}&fields=files(id,name,webViewLink)&spaces=drive`);
  const found = (await search.json()).files?.[0];
  if (found) return found;
  const created = await driveRequest(token, '/files?fields=id,name,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }),
  });
  return created.json();
};

const uploadPdf = async (token: string, bytes: Uint8Array, fileName: string, parentId: string) => {
  const boundary = `ekv_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: fileName, mimeType: 'application/pdf', parents: [parentId] });
  const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`);
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(prefix.length + bytes.length + suffix.length);
  body.set(prefix); body.set(bytes, prefix.length); body.set(suffix, prefix.length + bytes.length);
  const response = await driveRequest(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,createdTime', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return response.json();
};

const callback = async (url: URL) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const fallback = 'https://portal.ekvproject.cz/settings/storage';
  if (!code || !state) return Response.redirect(`${fallback}?googleDrive=error`, 302);
  const db = serviceClient();
  const stateHash = await sha256(state);
  const { data: oauthState } = await db.from('google_drive_oauth_states')
    .select('*').eq('state_hash', stateHash).is('consumed_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!oauthState) return Response.redirect(`${fallback}?googleDrive=invalid_state`, 302);
  try {
    await assertActiveAccount(db, oauthState.user_id);
    const tokens = await exchangeCode(code);
    const profileResponse = await fetchWithTimeout('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = profileResponse.ok ? await profileResponse.json() : {};
    await db.from('google_drive_oauth_connections').upsert({
      user_id: oauthState.user_id,
      google_email: profile.email || null,
      encrypted_access_token: await encrypt(tokens.access_token),
      encrypted_refresh_token: tokens.refresh_token ? await encrypt(tokens.refresh_token) : null,
      token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
      scopes: String(tokens.scope || '').split(' ').filter(Boolean),
      status: 'active',
      metadata: { google_sub: profile.sub || null },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    await db.from('google_drive_oauth_states').update({ consumed_at: new Date().toISOString() }).eq('id', oauthState.id);
    return Response.redirect(`${oauthState.redirect_after || fallback}?googleDrive=connected`, 302);
  } catch (error) {
    console.error('Google OAuth callback failed', error);
    return Response.redirect(`${fallback}?googleDrive=error`, 302);
  }
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) return callback(url);
  if (Deno.env.get('GOOGLE_ESIGNATURE_POC_ENABLED') === 'false') {
    return json({ success: false, error: 'Google Drive eSignature je v konfiguraci vypnutý.' }, 503);
  }

  try {
    const { db, user } = await authenticateAdmin(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'status');

    if (action === 'status') {
      try {
        const { token, connection, shared } = await activeAccessToken(db, user.id);
        const about = await driveRequest(token, '/about?fields=user(displayName,emailAddress,permissionId)');
        return json({
          success: true,
          configured: true,
          connected: true,
          shared,
          connection: {
            google_email: connection.google_email || about.user?.emailAddress || null,
            status: connection.status,
            token_expires_at: connection.token_expires_at,
            updated_at: connection.updated_at,
          },
          drive_user: about.user || null,
        });
      } catch (error) {
        return json({
          success: true,
          configured: true,
          connected: false,
          shared: false,
          connection: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (action === 'getAuthorizationUrl') {
      const state = bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, '');
      await db.from('google_drive_oauth_states').insert({
        user_id: user.id,
        state_hash: await sha256(state),
        redirect_after: body.redirectAfter || 'https://portal.ekvproject.cz/settings/storage',
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.search = new URLSearchParams({
        client_id: requiredEnv('GOOGLE_DRIVE_CLIENT_ID'),
        redirect_uri: requiredEnv('GOOGLE_DRIVE_REDIRECT_URI'),
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        scope: 'openid email https://www.googleapis.com/auth/drive.file',
        state,
      }).toString();
      return json({ success: true, authorizationUrl: authUrl.toString() });
    }

    if (action === 'listRequests') {
      const query = db.from('document_signature_requests').select('*,signers:document_signature_signers(*)').order('created_at', { ascending: false });
      const { data, error } = body.protocolId ? await query.eq('protocol_id', body.protocolId) : await query.limit(50);
      if (error) throw error;
      return json({ success: true, requests: data || [] });
    }

    if (action === 'uploadForSignature') {
      if (!body.protocolId || !body.pdfBase64) throw new Error('Protocol and PDF are required.');
      const bytes = base64ToBytes(body.pdfBase64);
      if (!bytes.length || bytes.length > MAX_PDF_SIZE) throw new Error('PDF is empty or exceeds 18 MB.');
      const signers = Array.isArray(body.signers) ? body.signers.slice(0, 10) : [];
      if (!signers.length || signers.some((signer: Record<string, unknown>) => !signer.name || !signer.email)) throw new Error('At least one valid signer is required.');
      const { token, connection, shared } = await activeAccessToken(db, user.id);
      const root = await ensureFolder(token, ROOT_FOLDER);
      const target = await ensureFolder(token, SIGNATURE_FOLDER, root.id);
      const fileName = `TEST-${String(body.fileName || 'dokument.pdf').replace(/[^a-zA-Z0-9._() -]+/g, '_')}`;
      const uploaded = await uploadPdf(token, bytes, fileName, target.id);
      const { data: request, error } = await db.from('document_signature_requests').insert({
        protocol_id: body.protocolId,
        provider: 'google_drive',
        status: 'prepared',
        drive_file_id: uploaded.id,
        drive_web_url: uploaded.webViewLink,
        source_document_hash: await sha256(bytes),
        requested_by: user.id,
        metadata: {
          file_name: fileName,
          template_id: body.templateId || null,
          poc: true,
          google_account: connection.google_email || null,
          organization_connection: shared,
        },
      }).select('*').single();
      if (error) throw error;
      await db.from('document_signature_signers').insert(signers.map((signer: Record<string, unknown>, index: number) => ({
        request_id: request.id,
        signer_order: index + 1,
        name: signer.name,
        email: signer.email,
        role: signer.role || 'Podepisující',
      })));
      await db.from('document_signature_events').insert({ request_id: request.id, actor_user_id: user.id, event_type: 'prepared', to_status: 'prepared', metadata: { drive_file_id: uploaded.id } });
      return json({ success: true, request: { ...request, signers }, driveFile: uploaded });
    }

    if (action === 'setRequestStatus') {
      const nextStatus = String(body.status || '');
      if (!['sent', 'signed', 'rejected', 'cancelled'].includes(nextStatus)) throw new Error('Unsupported signature status.');
      const { data: current } = await db.from('document_signature_requests').select('*').eq('id', body.requestId).single();
      if (!current) throw new Error('Signature request not found.');
      const patch: Record<string, unknown> = { status: nextStatus, updated_at: new Date().toISOString() };
      if (nextStatus === 'sent') patch.sent_at = new Date().toISOString();
      if (nextStatus === 'signed') patch.signed_at = new Date().toISOString();
      if (nextStatus === 'cancelled') patch.cancelled_at = new Date().toISOString();
      if (body.signedDriveFileId) patch.signed_drive_file_id = body.signedDriveFileId;
      if (body.signedDriveUrl) patch.signed_drive_url = body.signedDriveUrl;
      await db.from('document_signature_requests').update(patch).eq('id', current.id);
      await db.from('document_signature_events').insert({
        request_id: current.id, actor_user_id: user.id, event_type: `status_${nextStatus}`,
        from_status: current.status, to_status: nextStatus, message: body.message || null,
      });
      if (nextStatus === 'signed' && current.protocol_id) {
        await db.from('handover_protocols').update({ status: 'signed', signature_provider: 'external', locked_at: new Date().toISOString() }).eq('id', current.protocol_id);
      }
      return json({ success: true });
    }

    return json({ success: false, error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('google-drive-esign error', error);
    return errorJson(error);
  }
});
