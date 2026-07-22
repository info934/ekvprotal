import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWithTimeout } from '../_shared/fetch.ts';

type StorageAction = 'testConnection' | 'ensureFolder' | 'createUploadSession' | 'registerUploadedFile' | 'uploadFile' | 'downloadUrl' | 'listFiles' | 'deleteFile';
type EntityType = 'project' | 'realizace' | 'product' | 'invoice';

type StorageTarget = {
  siteId?: string;
  driveId?: string;
  rootFolderId?: string;
  rootFolderPath?: string;
  structure?: string[];
};

type StorageConnection = {
  id: string;
  provider: string;
  status: string;
  config: Record<string, unknown> & {
    siteId?: string;
    driveId?: string;
    rootFolderId?: string;
    rootFolderPath?: string;
    projectStructure?: string[];
    realizationStructure?: string[];
    targets?: Partial<Record<EntityType, StorageTarget>>;
  };
};

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const GRAPH_TOKEN_EXPIRY_BUFFER_MS = 60_000;
let graphTokenCache: { token: string; expiresAt: number } | null = null;
let graphTokenRequest: Promise<string> | null = null;
const ALLOWED_ENTITY_TYPES = new Set<EntityType>(['project', 'realizace', 'product', 'invoice']);
const ENTITY_PERMISSION_MODULES: Record<EntityType, string[]> = {
  project: ['projects', 'documents'],
  realizace: ['realizace', 'projects', 'documents'],
  product: ['crm'],
  invoice: ['payouts', 'projects'],
};

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

const safeSegment = (value: unknown) => String(value || '')
  .trim()
  .replace(/[~"#%&*:<>?/\\{|}]+/g, '-')
  .replace(/[. ]+$/g, '')
  .slice(0, 120);

const normalizePath = (...parts: Array<string | undefined>) => parts
  .flatMap((part) => String(part || '').split('/'))
  .filter((part) => part.trim().length > 0)
  .map(safeSegment)
  .filter(Boolean)
  .join('/');

const graphError = async (response: Response) => {
  const payload = await response.json().catch(() => ({}));
  const message = payload?.error?.message || `Microsoft Graph returned ${response.status}.`;
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = response.status;
  error.code = payload?.error?.code;
  return error;
};

const getGraphToken = async () => {
  if (graphTokenCache && graphTokenCache.expiresAt > Date.now() + GRAPH_TOKEN_EXPIRY_BUFFER_MS) {
    return graphTokenCache.token;
  }
  if (graphTokenRequest) return graphTokenRequest;

  const tenantId = Deno.env.get('MS_GRAPH_TENANT_ID');
  const clientId = Deno.env.get('MS_GRAPH_CLIENT_ID');
  const clientSecret = Deno.env.get('MS_GRAPH_CLIENT_SECRET');

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('SharePoint credentials are not configured in Supabase secrets.');
  }

  graphTokenRequest = (async () => {
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
    const data = await response.json();
    const token = String(data.access_token);
    graphTokenCache = {
      token,
      expiresAt: Date.now() + Math.max(Number(data.expires_in || 3600) * 1000, 60_000),
    };
    return token;
  })().finally(() => {
    graphTokenRequest = null;
  });

  return graphTokenRequest;
};

type StorageFolderMapping = {
  external_folder_id: string | null;
  folder_path: string | null;
};

const graphFetch = async (token: string, path: string, init: RequestInit = {}) => {
  const response = await fetchWithTimeout(`${GRAPH_ROOT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!response.ok) throw await graphError(response);
  if (response.status === 204) return null;
  return response.json();
};

const graphFetchAbsolute = async (token: string, url: string) => {
  const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw await graphError(response);
  return response.json();
};

const collectGraphPages = async (token: string, firstPath: string) => {
  const values: Array<Record<string, unknown>> = [];
  const visited = new Set<string>();
  let page = await graphFetch(token, firstPath);
  for (let pageNumber = 0; pageNumber < 25; pageNumber += 1) {
    values.push(...(page?.value || []));
    if (values.length >= 2_000) return values.slice(0, 2_000);
    const nextLink = page?.['@odata.nextLink'];
    if (!nextLink) break;
    if (visited.has(String(nextLink))) throw new Error('Microsoft Graph pagination returned a repeated page.');
    visited.add(String(nextLink));
    page = await graphFetchAbsolute(token, String(nextLink));
  }
  return values;
};

const resolveTarget = (connection: StorageConnection, entityType: EntityType): StorageTarget => {
  const config = connection.config || {};
  const configured = config.targets?.[entityType];
  const fallbackStructure = entityType === 'project'
    ? config.projectStructure
    : entityType === 'realizace'
      ? config.realizationStructure
      : [];

  const target = {
    siteId: configured?.siteId || config.siteId,
    driveId: configured?.driveId || config.driveId,
    rootFolderId: configured?.rootFolderId || config.rootFolderId,
    rootFolderPath: configured?.rootFolderPath ?? config.rootFolderPath,
    structure: configured?.structure || fallbackStructure || [],
  };

  if (!target.driveId) throw new Error(`SharePoint drive is not configured for ${entityType}.`);
  return target;
};

const getChildByName = async (token: string, driveId: string, parentId: string, name: string) => {
  const values = await collectGraphPages(
    token,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}/children?$select=id,name,webUrl,folder&$top=200`,
  );
  return values.find((item: { name?: unknown }) => String(item.name || '').localeCompare(name, undefined, { sensitivity: 'accent' }) === 0) || null;
};

const ensurePath = async (token: string, target: StorageTarget, folderPath: string) => {
  const driveId = String(target.driveId);
  const combinedPath = normalizePath(target.rootFolderPath, folderPath);
  const segments = combinedPath.split('/').filter(Boolean);
  let parent = target.rootFolderId
    ? await graphFetch(token, `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(target.rootFolderId)}`)
    : await graphFetch(token, `/drives/${encodeURIComponent(driveId)}/root`);

  for (const segment of segments) {
    let item = await getChildByName(token, driveId, parent.id, segment);

    if (!item) {
      try {
        item = await graphFetch(token, `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parent.id)}/children`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: segment,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail',
          }),
        });
      } catch (error) {
        if ((error as { status?: number }).status !== 409) throw error;
        item = await getChildByName(token, driveId, parent.id, segment);
        if (!item) throw error;
      }
    }
    parent = item;
  }

  return { item: parent, folderPath: combinedPath };
};

const ensureStructure = async (token: string, target: StorageTarget, baseFolderId: string) => {
  const created: Array<{ id: string; name: string; path: string; webUrl?: string }> = [];
  const knownFolders = new Map<string, { id: string; name: string; webUrl?: string }>();

  for (const configuredPath of target.structure || []) {
    const segments = String(configuredPath).split('/').map(safeSegment).filter(Boolean);
    let parentId = baseFolderId;
    let currentPath = '';
    let item: { id: string; name: string; webUrl?: string } | null = null;

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      item = knownFolders.get(currentPath) || await getChildByName(token, String(target.driveId), parentId, segment);

      if (!item) {
        try {
          item = await graphFetch(
            token,
            `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(parentId)}/children`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: segment,
                folder: {},
                '@microsoft.graph.conflictBehavior': 'fail',
              }),
            },
          );
        } catch (error) {
          if ((error as { status?: number }).status !== 409) throw error;
          item = await getChildByName(token, String(target.driveId), parentId, segment);
          if (!item) throw error;
        }
      }

      knownFolders.set(currentPath, item);
      parentId = item.id;
    }

    if (item) created.push({ id: item.id, name: item.name, path: currentPath, webUrl: item.webUrl });
  }
  return created;
};

const base64ToBytes = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const getEntityFolderMapping = async (
  admin: ReturnType<typeof createClient>,
  connectionId: string,
  entityType: EntityType,
  entityId: string,
) => {
  const { data, error } = await admin
    .from('document_storage_folders')
    .select('external_folder_id, folder_path')
    .eq('connection_id', connectionId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();

  if (error) throw error;
  return data as StorageFolderMapping | null;
};

const assertFolderPathBelongsToEntity = (
  folderPath: string,
  mapping: StorageFolderMapping | null,
  target: StorageTarget,
) => {
  if (!mapping?.folder_path) return;
  const normalizedRequested = normalizePath(target.rootFolderPath, folderPath);
  const normalizedRoot = normalizePath(mapping.folder_path);
  if (normalizedRequested !== normalizedRoot && !normalizedRequested.startsWith(`${normalizedRoot}/`)) {
    const error = new Error('Requested folder is outside the mapped entity folder.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
};

const isItemAtOrBelowFolder = async (
  token: string,
  driveId: string,
  itemId: string,
  allowedFolderId: string,
) => {
  let currentId = itemId;
  for (let depth = 0; depth < 40 && currentId; depth += 1) {
    if (currentId === allowedFolderId) return true;
    const item = await graphFetch(
      token,
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(currentId)}?$select=id,parentReference`,
    );
    const parentId = item?.parentReference?.id;
    if (!parentId || parentId === currentId) return false;
    currentId = parentId;
  }
  return false;
};

const assertItemBelongsToEntityFolder = async (
  token: string,
  target: StorageTarget,
  itemId: string,
  mapping: StorageFolderMapping | null,
) => {
  const allowedFolderId = mapping?.external_folder_id;
  if (!allowedFolderId) {
    const error = new Error('Entity folder mapping was not found.') as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  const allowed = await isItemAtOrBelowFolder(token, String(target.driveId), itemId, allowedFolderId);
  if (!allowed) {
    const error = new Error('Requested SharePoint item is outside the mapped entity folder.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
};

const getServerEntityFolderPath = async (
  admin: ReturnType<typeof createClient>,
  entityType: EntityType,
  entityId: string,
) => {
  if (entityType === 'invoice') return '';
  const table = entityType === 'project'
    ? 'projects'
    : entityType === 'realizace'
      ? 'realizations'
      : 'commercial_item_catalog';
  const { data, error } = await admin.from(table).select('id, code, name').eq('id', entityId).maybeSingle();
  if (error) throw error;
  if (!data) {
    const notFound = new Error('Storage entity was not found.') as Error & { status?: number };
    notFound.status = 404;
    throw notFound;
  }
  const root = entityType === 'project' ? 'projects' : entityType === 'realizace' ? 'realizace' : 'products';
  return normalizePath(root, [data.code, data.name].filter(Boolean).join(' - ') || data.id);
};

const assertInvoiceAccessLink = (entityId: string, accessEntityType: string, accessEntityId: string) => {
  if (['payout', 'hourly_payout'].includes(accessEntityType) && entityId !== accessEntityId) {
    const error = new Error('Invoice owner does not match the authorized payout.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service configuration.');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ success: false, error: 'Missing authorization.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return jsonResponse({ success: false, error: 'Invalid session.' }, 401);

    const body = await req.json();
    const action = body.action as StorageAction;
    const provider = String(body.provider || 'sharepoint');
    const entityType = String(body.entityType || 'project') as EntityType;
    if (!action || !body.connectionId) return jsonResponse({ success: false, error: 'Missing action or connection.' }, 400);
    if (provider !== 'sharepoint') return jsonResponse({ success: false, error: 'Only SharePoint is implemented by this function.' }, 400);
    if (!ALLOWED_ENTITY_TYPES.has(entityType)) return jsonResponse({ success: false, error: 'Unsupported entity type.' }, 400);
    const entityId = body.entityId ? String(body.entityId) : '';
    if (action !== 'testConnection' && !entityId) {
      return jsonResponse({ success: false, error: 'Entity ID is required for this storage action.' }, 400);
    }

    const { data: member } = await admin
      .from('members')
      .select('user_role')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    const role = String(member?.user_role || '');
    const isAdmin = role === 'admin';
    const requiredModules = action === 'testConnection' ? ['settings'] : ENTITY_PERMISSION_MODULES[entityType];
    const { data: permissionRows } = await admin
      .from('role_permissions')
      .select('module, can_read, can_edit, can_admin')
      .eq('role', role)
      .in('module', requiredModules);
    const hasPermission = isAdmin || (permissionRows || []).some((permission) => {
      if (action === 'testConnection') return permission.can_admin;
      if (action === 'downloadUrl' || action === 'listFiles') return permission.can_read || permission.can_edit || permission.can_admin;
      return permission.can_edit || permission.can_admin;
    });
    if (!hasPermission) return jsonResponse({ success: false, error: 'You do not have permission for this storage action.' }, 403);

    if (action !== 'testConnection') {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
      if (!anonKey) throw new Error('Missing Supabase anonymous key.');
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const accessEntityType = String(body.accessEntityType || entityType);
      const accessEntityId = String(body.accessEntityId || entityId);
      if (entityType !== 'invoice' && (accessEntityType !== entityType || accessEntityId !== entityId)) {
        return jsonResponse({ success: false, error: 'Storage access scope does not match the target entity.' }, 403);
      }
      if (entityType === 'invoice') assertInvoiceAccessLink(entityId, accessEntityType, accessEntityId);
      let canAccess = false;
      if (accessEntityType === 'project') {
        const { data } = await userClient.rpc('can_access_project', { p_project_id: accessEntityId });
        canAccess = data === true;
      } else if (accessEntityType === 'realizace' || accessEntityType === 'realization') {
        const { data } = await userClient.rpc('can_access_realization', { p_realization_id: accessEntityId });
        canAccess = data === true;
      } else if (accessEntityType === 'product') {
        const { data } = await userClient.from('commercial_item_catalog').select('id').eq('id', accessEntityId).maybeSingle();
        canAccess = Boolean(data);
      } else if (accessEntityType === 'payout') {
        const { data } = await userClient.from('payouts').select('id').eq('id', accessEntityId).maybeSingle();
        canAccess = Boolean(data);
      } else if (accessEntityType === 'hourly_payout') {
        const { data } = await userClient.from('hourly_payout_requests').select('id').eq('id', accessEntityId).maybeSingle();
        canAccess = Boolean(data);
      }
      if (!canAccess) return jsonResponse({ success: false, error: 'You cannot access this entity.' }, 403);
    }

    const { data: connection, error: connectionError } = await admin
      .from('document_storage_connections')
      .select('id, provider, status, config')
      .eq('id', body.connectionId)
      .single();
    if (connectionError || !connection) return jsonResponse({ success: false, error: 'Storage connection was not found.' }, 404);
    if (connection.status !== 'active' && action !== 'testConnection') return jsonResponse({ success: false, error: 'Storage connection is not active.' }, 409);

    const graphToken = await getGraphToken();
    const target = resolveTarget(connection as StorageConnection, entityType);
    const requiresEntityScope = action !== 'testConnection' && action !== 'ensureFolder' && entityType !== 'invoice';
    if (requiresEntityScope && !entityId) {
      return jsonResponse({ success: false, error: 'Entity ID is required for this storage action.' }, 400);
    }
    const entityFolderMapping = requiresEntityScope
      ? await getEntityFolderMapping(admin, String(connection.id), entityType, entityId)
      : null;

    if (action === 'testConnection') {
      const drive = await graphFetch(graphToken, `/drives/${encodeURIComponent(String(target.driveId))}`);
      return jsonResponse({
        success: true,
        provider,
        entityType,
        drive: { id: drive.id, name: drive.name, webUrl: drive.webUrl },
      });
    }

    if (action === 'ensureFolder') {
      const existingMapping = await getEntityFolderMapping(admin, String(connection.id), entityType, entityId);
      if (existingMapping?.external_folder_id) {
        const existingItem = await graphFetch(
          graphToken,
          `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(existingMapping.external_folder_id)}`,
        );
        const structure = await ensureStructure(graphToken, target, existingMapping.external_folder_id);
        return jsonResponse({
          success: true,
          provider,
          status: 'created',
          folderId: existingMapping.external_folder_id,
          externalFolderId: existingMapping.external_folder_id,
          folderPath: existingMapping.folder_path,
          webUrl: existingItem.webUrl,
          metadata: { driveId: target.driveId, siteId: target.siteId, structure, structureVersion: 2, reusedMapping: true },
        });
      }

      const requestedPath = await getServerEntityFolderPath(admin, entityType, entityId);
      const result = await ensurePath(graphToken, target, requestedPath);
      const structure = await ensureStructure(graphToken, target, result.item.id);
      const mappingPayload = {
        connection_id: connection.id,
        entity_type: entityType,
        entity_id: entityId,
        folder_path: result.folderPath,
        external_folder_id: result.item.id,
        external_web_url: result.item.webUrl,
        status: 'created',
        metadata: { driveId: target.driveId, siteId: target.siteId, structure, structureVersion: 2 },
        updated_at: new Date().toISOString(),
      };
      const { error: mappingError } = await admin
        .from('document_storage_folders')
        .upsert(mappingPayload, { onConflict: 'connection_id,entity_type,entity_id' });
      if (mappingError) throw mappingError;
      return jsonResponse({
        success: true,
        provider,
        status: 'created',
        folderId: result.item.id,
        externalFolderId: result.item.id,
        folderPath: result.folderPath,
        webUrl: result.item.webUrl,
        metadata: mappingPayload.metadata,
      });
    }

    if (action === 'createUploadSession') {
      const fileName = safeSegment(body.fileName);
      let folderId = body.folderId ? String(body.folderId) : '';
      let folderPath = String(body.folderPath || '');
      if (!folderId) {
        assertFolderPathBelongsToEntity(folderPath, entityFolderMapping, target);
        const result = await ensurePath(graphToken, target, folderPath);
        folderId = result.item.id;
        folderPath = result.folderPath;
      }
      if (entityFolderMapping) {
        await assertItemBelongsToEntityFolder(graphToken, target, folderId, entityFolderMapping);
      }
      const session = await graphFetch(
        graphToken,
        `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(fileName)}:/createUploadSession`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename', name: fileName } }),
        },
      );
      return jsonResponse({ success: true, uploadUrl: session.uploadUrl, folderId, folderPath, fileName });
    }

    if (action === 'registerUploadedFile') {
      const fileId = String(body.fileId || '');
      const folderId = String(body.folderId || '');
      if (!fileId || !folderId) return jsonResponse({ success: false, error: 'Uploaded file and folder IDs are required.' }, 400);
      if (entityFolderMapping) {
        await assertItemBelongsToEntityFolder(graphToken, target, fileId, entityFolderMapping);
      }
      const uploaded = await graphFetch(graphToken, `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(fileId)}`);
      if (String(uploaded?.parentReference?.id || '') !== folderId) {
        return jsonResponse({ success: false, error: 'Uploaded file does not belong to the requested folder.' }, 403);
      }
      const ownerType = entityType === 'invoice' ? String(body.accessEntityType || 'invoice') : entityType;
      const ownerId = entityType === 'invoice' ? String(body.accessEntityId || entityId) : entityId;
      const { error: registryError } = await admin.from('document_storage_files').upsert({
        connection_id: connection.id,
        entity_type: entityType,
        entity_id: entityId,
        owner_type: ownerType,
        owner_id: ownerId,
        external_file_id: uploaded.id,
        external_parent_id: folderId,
        file_name: uploaded.name || safeSegment(body.fileName),
        external_web_url: uploaded.webUrl,
        metadata: body.metadata || {},
        uploaded_by: user.id,
      }, { onConflict: 'connection_id,external_file_id' });
      if (registryError) throw registryError;
      return jsonResponse({
        success: true,
        provider,
        fileId: uploaded.id,
        parentId: folderId,
        filePath: normalizePath(String(body.folderPath || ''), uploaded.name || safeSegment(body.fileName)),
        webUrl: uploaded.webUrl,
        metadata: { driveId: target.driveId, siteId: target.siteId, size: uploaded.size, eTag: uploaded.eTag, mimeType: uploaded.file?.mimeType },
      });
    }

    if (action === 'uploadFile') {
      const fileName = safeSegment(body.fileName);
      const fileBase64 = String(body.fileBase64 || '');
      if (!fileBase64) return jsonResponse({ success: false, error: 'File content is required.' }, 400);

      let folderId = body.folderId ? String(body.folderId) : '';
      let folderPath = String(body.folderPath || '');
      if (!folderId) {
        assertFolderPathBelongsToEntity(folderPath, entityFolderMapping, target);
        const result = await ensurePath(graphToken, target, folderPath);
        folderId = result.item.id;
        folderPath = result.folderPath;
      }
      if (entityFolderMapping) {
        await assertItemBelongsToEntityFolder(graphToken, target, folderId, entityFolderMapping);
      }

      const uploaded = await graphFetch(
        graphToken,
        `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(fileName)}:/content?@microsoft.graph.conflictBehavior=rename`,
        {
          method: 'PUT',
          headers: { 'Content-Type': String(body.contentType || 'application/octet-stream') },
          body: base64ToBytes(fileBase64),
        },
      );

      const ownerType = entityType === 'invoice' ? String(body.accessEntityType || 'invoice') : entityType;
      const ownerId = entityType === 'invoice' ? String(body.accessEntityId || entityId) : entityId;
      const { error: registryError } = await admin.from('document_storage_files').insert({
        connection_id: connection.id,
        entity_type: entityType,
        entity_id: entityId,
        owner_type: ownerType,
        owner_id: ownerId,
        external_file_id: uploaded.id,
        external_parent_id: folderId,
        file_name: fileName,
        external_web_url: uploaded.webUrl,
        metadata: body.metadata || {},
        uploaded_by: user.id,
      });
      if (registryError) {
        await graphFetch(
          graphToken,
          `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(String(uploaded.id))}`,
          { method: 'DELETE' },
        ).catch(() => null);
        throw registryError;
      }

      return jsonResponse({
        success: true,
        provider,
        fileId: uploaded.id,
        parentId: folderId,
        filePath: normalizePath(folderPath, fileName),
        webUrl: uploaded.webUrl,
        metadata: {
          driveId: target.driveId,
          siteId: target.siteId,
          size: uploaded.size,
          eTag: uploaded.eTag,
          mimeType: uploaded.file?.mimeType,
        },
      });
    }

    if (action === 'downloadUrl') {
      if (!body.fileId) return jsonResponse({ success: false, error: 'File ID is required.' }, 400);
      const { data: registeredFile } = await admin
        .from('document_storage_files')
        .select('external_file_id')
        .eq('connection_id', connection.id)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .eq('external_file_id', String(body.fileId))
        .maybeSingle();
      if (!registeredFile) return jsonResponse({ success: false, error: 'File is not registered for this entity.' }, 403);
      const item = await graphFetch(graphToken, `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(String(body.fileId))}`);
      if (entityFolderMapping) {
        await assertItemBelongsToEntityFolder(graphToken, target, String(body.fileId), entityFolderMapping);
      }
      return jsonResponse({ success: true, webUrl: item.webUrl, downloadUrl: item['@microsoft.graph.downloadUrl'] || null });
    }

    if (action === 'listFiles') {
      if (entityType === 'invoice') {
        return jsonResponse({ success: false, error: 'Listing the shared invoice folder is not allowed.' }, 403);
      }
      if (!body.folderId) return jsonResponse({ success: false, error: 'Folder ID is required.' }, 400);
      if (entityFolderMapping) {
        await assertItemBelongsToEntityFolder(graphToken, target, String(body.folderId), entityFolderMapping);
      }
      const items = await collectGraphPages(graphToken, `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(String(body.folderId))}/children?$select=id,name,size,webUrl,lastModifiedDateTime,file,folder&$top=200`);
      return jsonResponse({ success: true, items });
    }

    if (action === 'deleteFile') {
      if (!body.fileId) return jsonResponse({ success: false, error: 'File ID is required.' }, 400);
      const fileId = String(body.fileId);
      const { data: registeredFile } = await admin
        .from('document_storage_files')
        .select('id, external_file_id')
        .eq('connection_id', connection.id)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .eq('external_file_id', fileId)
        .maybeSingle();
      if (!registeredFile) return jsonResponse({ success: false, error: 'File is not registered for this entity.' }, 403);
      if (entityFolderMapping) await assertItemBelongsToEntityFolder(graphToken, target, fileId, entityFolderMapping);
      try {
        await graphFetch(graphToken, `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      } catch (deleteError) {
        if ((deleteError as { status?: number }).status !== 404) throw deleteError;
      }
      const { error: registryDeleteError } = await admin.from('document_storage_files').delete().eq('id', registeredFile.id);
      if (registryDeleteError) throw registryDeleteError;
      return jsonResponse({ success: true, deleted: true, fileId });
    }

    return jsonResponse({ success: false, error: 'Unsupported action.' }, 400);
  } catch (error) {
    console.error('[document-storage]', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unexpected document storage error.',
    }, (error as { status?: number }).status || 500);
  }
});
