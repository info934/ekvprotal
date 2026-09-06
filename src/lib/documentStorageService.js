import { supabase } from '@/lib/customSupabaseClient';
import { fetchWithTimeout } from '@/lib/http';
import { invokeWithTimeout } from '@/lib/requestControl';

const PROJECT_BUCKET = 'project-files';
const INVOICE_BUCKET = 'invoices';
const PRODUCT_DATASHEET_FOLDER = 'product-datasheets';
const DEFAULT_CONNECTION_CACHE_TTL = 5 * 60 * 1000;
const FOLDER_LIST_CACHE_TTL = 60 * 1000;
const SIMPLE_EXTERNAL_UPLOAD_LIMIT = 3 * 1024 * 1024;
const GRAPH_UPLOAD_CHUNK_SIZE = 10 * 320 * 1024;
const COMMERCIAL_DOCUMENT_FOLDERS = {
  'odberatelska-faktura': 'Odberatelske faktury',
  'obchodni-smlouva': 'Obchodni smlouvy',
};

let defaultConnectionCache = null;
let defaultConnectionPromise = null;
const folderListCache = new Map();
const folderListRequests = new Map();

const MISSING_STORAGE_CONFIG_CODES = new Set(['42P01', '42703', 'PGRST116', 'PGRST204', 'PGRST205']);

const invokeDocumentStorage = async (options, timeoutMs = 60_000) => {
  const result = await invokeWithTimeout(supabase, 'document-storage', options, timeoutMs);
  if (!result.error?.context) return result;

  // Supabase otherwise collapses a useful Edge Function response into a generic
  // "non-2xx" error, which made permission failures look like server outages.
  const response = result.error.context;
  if (typeof response.clone !== 'function') return result;

  try {
    const payload = await response.clone().json();
    if (payload?.error) {
      return {
        ...result,
        error: Object.assign(new Error(payload.error), {
          code: payload.code || result.error.code,
          status: response.status,
        }),
      };
    }
  } catch {
    // Keep the original client error when the function did not return JSON.
  }

  return result;
};

const uploadExternalFile = async ({ file, body }) => {
  const uploadBody = { ...body, fileSize: file.size };
  if (file.size <= SIMPLE_EXTERNAL_UPLOAD_LIMIT) {
    return invokeDocumentStorage({
      body: { ...uploadBody, action: 'uploadFile', fileBase64: await fileToBase64(file) },
    });
  }

  const { data: session, error: sessionError } = await invokeDocumentStorage({
    body: { ...uploadBody, action: 'createUploadSession' },
  });
  if (sessionError) throw sessionError;
  if (!session?.success || !session.uploadUrl) throw new Error(session?.error || 'Upload session could not be created.');

  let uploadedItem = null;
  for (let start = 0; start < file.size; start += GRAPH_UPLOAD_CHUNK_SIZE) {
    const endExclusive = Math.min(file.size, start + GRAPH_UPLOAD_CHUNK_SIZE);
    const response = await fetchWithTimeout(session.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(endExclusive - start),
        'Content-Range': `bytes ${start}-${endExclusive - 1}/${file.size}`,
      },
      body: file.slice(start, endExclusive),
    }, { timeoutMs: 120_000 });
    if (!response.ok) throw new Error(`Chunk upload failed (${response.status}).`);
    const payload = await response.json();
    if (response.status === 200 || response.status === 201) uploadedItem = payload;
  }
  if (!uploadedItem?.id) throw new Error('External storage did not confirm the uploaded file.');

  return invokeDocumentStorage({
    body: {
      ...uploadBody,
      action: 'registerUploadedFile',
      fileId: uploadedItem.id,
      folderId: session.folderId,
      folderPath: session.folderPath,
      fileName: uploadedItem.name || body.fileName,
    },
  });
};

export const isStorageConfigMissingError = (error) => {
  if (!error) return false;
  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return MISSING_STORAGE_CONFIG_CODES.has(error.code) ||
    message.includes('document_storage_connections') ||
    message.includes('storage_provider') ||
    message.includes('storage_connection_id') ||
    message.includes('external_file_id');
};

const fallbackConnection = {
  id: null,
  provider: 'supabase',
  name: 'Supabase Storage',
  status: 'active',
  is_default: true,
  config: {
    projectBucket: PROJECT_BUCKET,
    invoiceBucket: INVOICE_BUCKET,
  },
};

const sanitizePathSegment = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 90) || 'item';

const normalizeFolderCode = (value) => String(value || '')
  .normalize('NFC')
  .replace(/[~"#%&*:<>?/\\{|}]+/g, '-')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

const normalizeFolderName = (value) => String(value || '')
  .normalize('NFC')
  .replace(/[~"#%&*:<>?/\\{|}]+/g, '-')
  .replace(/\s+/g, ' ')
  .replace(/^\s*-+\s*/, '')
  .replace(/\s*-+\s*$/, '')
  .replace(/[. ]+$/g, '')
  .trim()
  .slice(0, 90);

const sanitizeReadableFileName = (value, fallback = 'soubor') => {
  const rawName = String(value || '').trim();
  const extensionMatch = rawName.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] || '';
  const baseName = extension ? rawName.slice(0, -extension.length) : rawName;
  const safeBaseName = baseName
    .replace(/[~"#%&*:<>?/\\{|}]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  const safeExtension = extension
    .replace(/[~"#%&*:<>?/\\{|}\s]+/g, '')
    .slice(0, 20);
  const availableBaseLength = Math.max(1, 180 - safeExtension.length);
  const result = `${safeBaseName.slice(0, availableBaseLength)}${safeExtension}`;
  return result || fallback;
};

const addReferencePrefix = (fileName, reference) => {
  const readableFileName = sanitizeReadableFileName(fileName);
  const readableReference = String(reference || '')
    .replace(/[~"#%&*:<>?/\\{|}]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 50);

  if (!readableReference) return readableFileName;
  const normalizedFileName = readableFileName.toLocaleLowerCase('cs-CZ');
  const normalizedReference = readableReference.toLocaleLowerCase('cs-CZ');
  if (
    normalizedFileName === normalizedReference ||
    normalizedFileName.startsWith(`${normalizedReference} - `) ||
    normalizedFileName.startsWith(`${normalizedReference}_`)
  ) {
    return readableFileName;
  }

  return sanitizeReadableFileName(`${readableReference} - ${readableFileName}`);
};

const addReadableUniqueSuffix = (fileName, seed = '') => {
  const readableFileName = sanitizeReadableFileName(fileName);
  const extensionMatch = readableFileName.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1] || '';
  const baseName = extension ? readableFileName.slice(0, -extension.length) : readableFileName;
  // Avoid bracket character classes here: Tailwind's content scanner treats
  // them as arbitrary utility candidates and emits invalid CSS.
  const timestamp = new Date().toISOString().replace(/-|:|T|Z|\./g, '').slice(0, 14);
  const entropy = `${seed}-${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-zA-Z0-9_-]+/g, '').slice(-8);
  return sanitizeReadableFileName(`${baseName} - ${timestamp}-${entropy}${extension}`);
};

const buildStoredFileName = (fileName, reference, seed = '') =>
  addReadableUniqueSuffix(addReferencePrefix(fileName, reference), seed);

const sanitizeRelativeFolderPath = (value, fallback) => String(value || fallback || '')
  .split('/')
  .map((segment) => sanitizePathSegment(segment))
  .filter(Boolean)
  .join('/');

export const getDefaultStorageConnection = async () => {
  if (defaultConnectionCache && defaultConnectionCache.expiresAt > Date.now()) {
    return defaultConnectionCache.value;
  }

  if (!defaultConnectionPromise) {
    defaultConnectionPromise = supabase
      .from('document_storage_connections')
      .select('*')
      .eq('is_default', true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error && !isStorageConfigMissingError(error)) throw error;
        const value = data || fallbackConnection;
        defaultConnectionCache = {
          value,
          expiresAt: Date.now() + DEFAULT_CONNECTION_CACHE_TTL,
        };
        return value;
      })
      .finally(() => {
        defaultConnectionPromise = null;
      });
  }

  return defaultConnectionPromise;
};

export const invalidateStorageConnectionCache = () => {
  defaultConnectionCache = null;
};

export const buildEntityFolderPath = ({ entityType, entityId, code, name }) => {
  const root = entityType === 'realizace' ? 'realizace' : entityType === 'product' ? 'products' : 'projects';
  const normalizedCode = normalizeFolderCode(code);
  const normalizedName = normalizeFolderName(name);
  const label = [normalizedCode, normalizedName].filter(Boolean).join(' - ');
  return `${root}/${label || sanitizePathSegment(entityId)}`;
};

const persistFolderMapping = async ({
  connection,
  entityType,
  entityId,
  folderPath,
  externalFolderId = null,
  externalWebUrl = null,
  status = 'created',
  metadata = {},
}) => {
  if (!connection?.id) return null;

  const { data, error } = await supabase.rpc('upsert_document_storage_folder', {
    p_connection_id: connection.id,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_folder_path: folderPath,
    p_external_folder_id: externalFolderId,
    p_external_web_url: externalWebUrl,
    p_status: status,
    p_metadata: metadata,
  });

  if (error) {
    if (isStorageConfigMissingError(error)) return null;
    throw error;
  }

  return data;
};

export const ensureEntityFolder = async ({ entityType, entityId, code, name, connection }) => {
  const activeConnection = connection || await getDefaultStorageConnection();
  const folderPath = buildEntityFolderPath({ entityType, entityId, code, name });

  if (activeConnection.provider === 'supabase') {
    await persistFolderMapping({
      connection: activeConnection,
      entityType,
      entityId,
      folderPath,
      metadata: { managedBy: 'supabase-storage' },
    });

    return {
      connection: activeConnection,
      connectionId: activeConnection.id,
      provider: 'supabase',
      folderPath,
      status: 'created',
    };
  }

  const { data, error } = await invokeDocumentStorage({
    body: {
      action: 'ensureFolder',
      connectionId: activeConnection.id,
      provider: activeConnection.provider,
      entityType,
      entityId,
      code,
      name,
      folderPath,
    },
  });

  if (error) throw error;
  if (data?.success === false) {
    throw new Error(data.error || 'Externi uloziste neni nakonfigurovane.');
  }

  return {
    connection: activeConnection,
    connectionId: activeConnection.id,
    provider: activeConnection.provider,
    folderPath,
    ...data,
  };
};

export const initializeProjectWorkspace = async ({ project, connection }) => {
  if (!project?.id) throw new Error('Projekt není uložený.');
  const activeConnection = connection || await getDefaultStorageConnection();

  if (activeConnection.provider === 'supabase') {
    return ensureEntityFolder({
      entityType: 'project',
      entityId: project.id,
      code: project.code,
      name: project.name,
      connection: activeConnection,
    });
  }

  const { data, error } = await invokeDocumentStorage({
    body: {
      action: 'initializeProjectWorkspace',
      connectionId: activeConnection.id,
      provider: activeConnection.provider,
      entityType: 'project',
      entityId: project.id,
    },
  }, 90_000);

  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || 'Projektové prostředí se nepodařilo připravit.');

  return {
    connection: activeConnection,
    connectionId: activeConnection.id,
    provider: activeConnection.provider,
    ...data,
  };
};

export const uploadProjectDocument = async ({ file, project, documentName }) => {
  const connection = await getDefaultStorageConnection();
  const folder = await ensureEntityFolder({
    entityType: 'project',
    entityId: project.id,
    code: project.code,
    name: project.name,
    connection,
  });
  const storedFileName = buildStoredFileName(file.name, project.code, project.id);

  if (connection.provider === 'supabase') {
    const filePath = `${project.id}/${folder.folderPath}/${storedFileName}`;
    const { error } = await supabase.storage.from(PROJECT_BUCKET).upload(filePath, file);

    if (error) throw error;

    return {
      provider: 'supabase',
      connectionId: connection.id,
      filePath,
      fileName: file.name,
      storageFields: {
        storage_provider: 'supabase',
        storage_connection_id: connection.id,
        storage_metadata: {
          bucket: PROJECT_BUCKET,
          folderPath: folder.folderPath,
          originalFileName: file.name,
          storedFileName,
          documentName: documentName || null,
        },
      },
      cleanup: async () => supabase.storage.from(PROJECT_BUCKET).remove([filePath]),
    };
  }

  const { data, error } = await uploadExternalFile({
    file,
    body: {
      connectionId: connection.id,
      provider: connection.provider,
      entityType: 'project',
      entityId: project.id,
      folderId: folder.externalFolderId,
      folderPath: folder.folderPath,
      fileName: storedFileName,
      contentType: file.type || 'application/octet-stream',
    },
  });

  if (error) throw error;
  if (data?.success === false) {
    throw new Error(data.error || 'Soubor se nepodarilo nahrat do externiho uloziste.');
  }

  return {
    provider: connection.provider,
    connectionId: connection.id,
    filePath: data.filePath || null,
    fileName: file.name,
    storageFields: {
      storage_provider: connection.provider,
      storage_connection_id: connection.id,
      external_file_id: data.fileId,
      external_parent_id: data.parentId || folder.externalFolderId,
      external_web_url: data.webUrl,
      storage_metadata: data.metadata || {},
    },
  };
};

export const uploadProjectCostInvoice = async ({ file, project, costId }) => {
  const connection = await getDefaultStorageConnection();
  const configuredInvoiceFolder = sanitizeRelativeFolderPath(
    connection.config?.targets?.project?.costInvoiceFolderPath,
    '04_Fakturace/Nakladove faktury',
  );
  await ensureEntityFolder({
    entityType: 'project',
    entityId: project.id,
    code: project.code,
    name: project.name,
    connection,
  });
  const storedFileName = buildStoredFileName(file.name, project.code, costId);
  const invoiceFolderPath = `${buildEntityFolderPath({
    entityType: 'project', entityId: project.id, code: project.code, name: project.name,
  })}/${configuredInvoiceFolder}`;

  if (connection.provider === 'supabase') {
    const filePath = `cost-invoices/project/${project.id}/${storedFileName}`;
    const { error } = await supabase.storage.from(PROJECT_BUCKET).upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    return {
      provider: 'supabase', connectionId: connection.id, dbUrl: `${PROJECT_BUCKET}/${filePath}`,
      filePath, fileId: filePath, fileName: file.name,
      storageFields: {
        invoice_url: `${PROJECT_BUCKET}/${filePath}`, invoice_name: file.name,
        invoice_storage_provider: 'supabase', invoice_storage_connection_id: connection.id,
        invoice_external_file_id: filePath, invoice_external_web_url: null,
        invoice_storage_metadata: { bucket: PROJECT_BUCKET, folderPath: invoiceFolderPath, storageRole: 'project_cost_invoice' },
      },
      cleanup: async () => supabase.storage.from(PROJECT_BUCKET).remove([filePath]),
    };
  }

  const { data, error } = await uploadExternalFile({
    file,
    body: {
      connectionId: connection.id, provider: connection.provider,
      entityType: 'project', entityId: project.id, folderPath: invoiceFolderPath,
      fileName: storedFileName, contentType: file.type || 'application/octet-stream',
      metadata: { documentKind: 'project_cost_invoice', costId, originalFileName: file.name },
    },
  });
  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || 'Fakturu se nepodařilo nahrát do projektové složky.');
  return {
    provider: connection.provider, connectionId: connection.id, dbUrl: data.webUrl,
    filePath: data.filePath, fileId: data.fileId, webUrl: data.webUrl, fileName: file.name,
    storageFields: {
      invoice_url: data.webUrl, invoice_name: file.name,
      invoice_storage_provider: connection.provider, invoice_storage_connection_id: connection.id,
      invoice_external_file_id: data.fileId, invoice_external_web_url: data.webUrl,
      invoice_storage_metadata: {
        ...(data.metadata || {}), folderPath: invoiceFolderPath, storageRole: 'project_cost_invoice',
      },
    },
    cleanup: async () => deleteExternalStorageFile({ connection, entityType: 'project', entityId: project.id, fileId: data.fileId }),
  };
};

export const uploadRealizationCostInvoice = async ({ file, realization, costId }) => {
  const connection = await getDefaultStorageConnection();
  const configuredInvoiceFolder = sanitizeRelativeFolderPath(
    connection.config?.targets?.realizace?.costInvoiceFolderPath,
    '02_Naklady/Faktury',
  );
  await ensureEntityFolder({
    entityType: 'realizace',
    entityId: realization.id,
    code: realization.code,
    name: realization.name,
    connection,
  });
  const storedFileName = buildStoredFileName(file.name, realization.code, costId);
  const invoiceFolderPath = `${buildEntityFolderPath({
    entityType: 'realizace', entityId: realization.id, code: realization.code, name: realization.name,
  })}/${configuredInvoiceFolder}`;

  if (connection.provider === 'supabase') {
    const filePath = `cost-invoices/realizace/${realization.id}/${storedFileName}`;
    const { error } = await supabase.storage.from(PROJECT_BUCKET).upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    return {
      provider: 'supabase', connectionId: connection.id, dbUrl: `${PROJECT_BUCKET}/${filePath}`,
      filePath, fileId: filePath, fileName: file.name,
      metadata: { bucket: PROJECT_BUCKET, folderPath: invoiceFolderPath, storageRole: 'realization_cost_invoice' },
      cleanup: async () => supabase.storage.from(PROJECT_BUCKET).remove([filePath]),
    };
  }

  const { data, error } = await uploadExternalFile({
    file,
    body: {
      connectionId: connection.id, provider: connection.provider,
      entityType: 'realizace', entityId: realization.id, folderPath: invoiceFolderPath,
      fileName: storedFileName, contentType: file.type || 'application/octet-stream',
      metadata: { documentKind: 'realization_cost_invoice', costId, originalFileName: file.name },
    },
  });
  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || 'Fakturu se nepodařilo nahrát do složky realizace.');
  return {
    provider: connection.provider, connectionId: connection.id, dbUrl: data.webUrl,
    filePath: data.filePath, fileId: data.fileId, webUrl: data.webUrl, fileName: file.name,
    metadata: { ...(data.metadata || {}), folderPath: invoiceFolderPath, storageRole: 'realization_cost_invoice' },
    cleanup: async () => deleteExternalStorageFile({ connection, entityType: 'realizace', entityId: realization.id, fileId: data.fileId }),
  };
};

export const getEntityStorageFolder = async ({ entityType, entityId }) => {
  const connection = await getDefaultStorageConnection();
  if (!connection?.id) return null;

  const { data, error } = await supabase
    .from('document_storage_folders')
    .select('*')
    .eq('connection_id', connection.id)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();

  if (error) {
    if (isStorageConfigMissingError(error)) return null;
    throw error;
  }

  return data ? { ...data, connection } : null;
};

const getFolderCacheKey = ({ entityType, entityId, folderId, connection }) =>
  `${connection?.id || connection?.provider || 'storage'}:${entityType}:${entityId || 'entity'}:${folderId}`;

export const invalidateEntityStorageFolderCache = ({ entityType, entityId, folderId, connection }) => {
  folderListCache.delete(getFolderCacheKey({ entityType, entityId, folderId, connection }));
};

const listEntityStorageFolderUncached = async ({ entityType, entityId, folderId, connection }) => {
  if (!connection || connection.provider === 'supabase') {
    return { items: [], provider: connection?.provider || 'supabase', supported: false };
  }

  const { data, error } = await invokeDocumentStorage({
    body: {
      action: 'listFiles',
      connectionId: connection.id,
      provider: connection.provider,
      entityType,
      entityId,
      folderId,
    },
  });

  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || 'Obsah složky se nepodařilo načíst.');
  return { items: data.items || [], provider: connection.provider, supported: true };
};

export const listEntityStorageFolder = async ({ entityType, entityId, folderId, connection, forceRefresh = false }) => {
  const cacheKey = getFolderCacheKey({ entityType, entityId, folderId, connection });
  const cached = folderListCache.get(cacheKey);
  if (!forceRefresh && cached?.expiresAt > Date.now()) return cached.value;
  if (!forceRefresh && folderListRequests.has(cacheKey)) return folderListRequests.get(cacheKey);

  const request = listEntityStorageFolderUncached({ entityType, entityId, folderId, connection })
    .then((value) => {
      folderListCache.set(cacheKey, { value, expiresAt: Date.now() + FOLDER_LIST_CACHE_TTL });
      return value;
    })
    .finally(() => {
      folderListRequests.delete(cacheKey);
    });

  folderListRequests.set(cacheKey, request);
  return request;
};

export const uploadEntityStorageFile = async ({ entityType, entityId, folderId, file, connection }) => {
  if (!connection || connection.provider === 'supabase') {
    throw new Error('Procházení složek je dostupné pouze pro externí úložiště.');
  }

  const { data, error } = await uploadExternalFile({
    file,
    body: {
      connectionId: connection.id,
      provider: connection.provider,
      entityType,
      entityId,
      folderId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      metadata: { originalFileName: file.name },
    },
  });

  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || 'Soubor se nepodařilo nahrát.');
  invalidateEntityStorageFolderCache({ entityType, entityId, folderId, connection });
  return data;
};

const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(file);
});

const getStorageConnectionById = async (connectionId) => {
  if (!connectionId) return null;

  const { data, error } = await supabase
    .from('document_storage_connections')
    .select('*')
    .eq('id', connectionId)
    .maybeSingle();

  if (error) {
    if (isStorageConfigMissingError(error)) return null;
    throw error;
  }

  return data;
};

export const uploadProductDatasheet = async ({ file, product, connectionId }) => {
  const selectedConnection = await getStorageConnectionById(connectionId);
  const connection = selectedConnection || await getDefaultStorageConnection();

  const folder = await ensureEntityFolder({
    entityType: 'product',
    entityId: product.id,
    code: product.sku || product.code,
    name: product.name,
    connection,
  });

  if (connection.provider === 'supabase') {
    const fileExt = file.name.split('.').pop();
    const safeName = sanitizePathSegment(file.name.replace(/\.[^.]+$/, ''));
    const filePath = `${PRODUCT_DATASHEET_FOLDER}/${product.id}/${safeName}_${Date.now()}.${fileExt}`;
    const { error } = await supabase.storage.from(PROJECT_BUCKET).upload(filePath, file);

    if (error) throw error;

    return {
      provider: 'supabase',
      connectionId: connection.id,
      fileName: file.name,
      filePath,
      storageFields: {
        datasheet_storage_provider: 'supabase',
        datasheet_storage_connection_id: connection.id,
        datasheet_external_file_id: filePath,
        datasheet_external_web_url: null,
        datasheet_file_name: file.name,
        datasheet_storage_metadata: {
          bucket: PROJECT_BUCKET,
          folderPath: folder.folderPath,
          filePath,
        },
      },
    };
  }

  const { data, error } = await uploadExternalFile({
    file,
    body: {
      connectionId: connection.id,
      provider: connection.provider,
      entityType: 'product',
      entityId: product.id,
      folderId: folder.externalFolderId,
      folderPath: folder.folderPath,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      metadata: {
        productCode: product.sku || product.code,
        productName: product.name,
        documentKind: 'datasheet',
      },
    },
  });

  if (error) throw error;
  if (data?.success === false) {
    throw new Error(data.error || 'Datasheet se nepodarilo nahrat do externiho uloziste.');
  }

  return {
    provider: connection.provider,
    connectionId: connection.id,
    fileName: file.name,
    storageFields: {
      datasheet_storage_provider: connection.provider,
      datasheet_storage_connection_id: connection.id,
      datasheet_external_file_id: data.fileId,
      datasheet_external_web_url: data.webUrl,
      datasheet_file_name: file.name,
      datasheet_storage_metadata: data.metadata || {},
    },
  };
};

export const uploadInvoiceDocument = async ({
  file,
  recordId,
  projectReference,
  category = 'ostatni',
  connection: providedConnection,
  accessEntityType,
  accessEntityId,
}) => {
  const connection = providedConnection || await getDefaultStorageConnection();
  const now = new Date();
  const uploadDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const safeRecordId = sanitizePathSegment(recordId);
  const readableFileName = sanitizeReadableFileName(file.name);
  const configuredCommercialFolder = category === 'obchodni-smlouva'
    ? connection.config?.targets?.invoice?.commercialContractFolderPath
    : category === 'odberatelska-faktura'
      ? connection.config?.targets?.invoice?.customerInvoiceFolderPath
      : null;
  const folderPath = COMMERCIAL_DOCUMENT_FOLDERS[category]
    ? sanitizeRelativeFolderPath(configuredCommercialFolder, COMMERCIAL_DOCUMENT_FOLDERS[category])
    : '';
  const storedFileName = projectReference
    ? buildStoredFileName(readableFileName, projectReference, recordId)
    : `${uploadDate}_${safeRecordId}_${readableFileName}`;

  if (connection.provider === 'supabase') {
    const normalizedAccessEntityType = accessEntityType === 'realization' ? 'realizace' : accessEntityType;
    if (!['payout', 'hourly_payout', 'project', 'realizace'].includes(normalizedAccessEntityType) || !accessEntityId) {
      throw new Error('Faktura musí být navázána na konkrétní výplatu, projekt nebo realizaci.');
    }
    const filePath = `${normalizedAccessEntityType}/${sanitizePathSegment(accessEntityId)}/${storedFileName}`;
    const { error } = await supabase.storage
      .from(INVOICE_BUCKET)
      .upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;

    return {
      provider: 'supabase',
      connectionId: connection.id,
      dbUrl: `${INVOICE_BUCKET}/${filePath}`,
      filePath,
      fileId: filePath,
      fileName: file.name,
      metadata: {
        bucket: INVOICE_BUCKET,
        originalFileName: file.name,
        category,
        folderPath,
        uploadedAt: now.toISOString(),
      },
      cleanup: async () => supabase.storage.from(INVOICE_BUCKET).remove([filePath]),
    };
  }

  const { data, error } = await uploadExternalFile({
    file,
    body: {
      connectionId: connection.id,
      provider: connection.provider,
      entityType: 'invoice',
      entityId: recordId,
      accessEntityType,
      accessEntityId,
      folderPath,
      fileName: storedFileName,
      contentType: file.type || 'application/octet-stream',
      metadata: {
        category,
        originalFileName: file.name,
        projectReference: projectReference || null,
        uploadedAt: now.toISOString(),
      },
    },
  });

  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || 'Fakturu se nepodařilo nahrát na SharePoint.');

  return {
    provider: connection.provider,
    connectionId: connection.id,
    dbUrl: data.webUrl,
    filePath: data.filePath,
    fileId: data.fileId,
    webUrl: data.webUrl,
    fileName: file.name,
    metadata: {
      ...(data.metadata || {}),
      originalFileName: file.name,
      category,
      uploadedAt: now.toISOString(),
    },
    cleanup: async () => deleteExternalStorageFile({
      connection,
      entityType: 'invoice',
      entityId: recordId,
      fileId: data.fileId,
      accessEntityType,
      accessEntityId,
    }),
  };
};

export const downloadProjectDocument = async (storedDocument) => {
  if (storedDocument.external_web_url && storedDocument.storage_provider !== 'supabase') {
    window.open(storedDocument.external_web_url, '_blank', 'noopener,noreferrer');
    return;
  }

  if (!storedDocument.file_path) {
    throw new Error('Cesta k souboru neni definovana.');
  }

  const { data, error } = await supabase.storage.from(PROJECT_BUCKET).download(storedDocument.file_path);
  if (error) throw error;

  const blob = new Blob([data]);
  const url = window.URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = storedDocument.file_name || 'document';
  window.document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  window.document.body.removeChild(a);
};

export const deleteExternalStorageFile = async ({ connection, entityType, entityId, fileId, accessEntityType, accessEntityId }) => {
  if (!connection?.id || !fileId) throw new Error('Chybi identifikace uloziste nebo souboru.');
  const { data, error } = await invokeDocumentStorage({
    body: {
      action: 'deleteFile',
      connectionId: connection.id,
      provider: connection.provider,
      entityType,
      entityId,
      fileId,
      accessEntityType,
      accessEntityId,
    },
  });
  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || 'Soubor se nepodarilo odstranit.');
  return data;
};

const normalizeBucketPath = (value, bucket) => {
  const raw = String(value || '').split('?')[0];
  const publicMarker = `/storage/v1/object/public/${bucket}/`;
  const signedMarker = `/storage/v1/object/sign/${bucket}/`;
  if (raw.includes(publicMarker)) return decodeURIComponent(raw.split(publicMarker)[1]);
  if (raw.includes(signedMarker)) return decodeURIComponent(raw.split(signedMarker)[1]);
  return raw.startsWith(`${bucket}/`) ? raw.slice(bucket.length + 1) : raw;
};

const triggerBrowserDownload = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.style.display = 'none';
  anchor.href = url;
  anchor.download = fileName || 'document';
  window.document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    window.document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  }, 150);
};

export const downloadStoredFile = async ({
  provider = 'supabase',
  connectionId,
  bucket,
  filePath,
  fileId,
  fileName,
  entityType,
  entityId,
  accessEntityType,
  accessEntityId,
}) => {
  if (provider === 'supabase' || !connectionId) {
    const targetBucket = bucket || (entityType === 'invoice' ? INVOICE_BUCKET : PROJECT_BUCKET);
    const targetPath = normalizeBucketPath(filePath || fileId, targetBucket);
    if (!targetPath) throw new Error('Cesta k souboru není definována.');
    const { data, error } = await supabase.storage.from(targetBucket).download(targetPath);
    if (error) throw error;
    triggerBrowserDownload(data, fileName || targetPath.split('/').pop());
    return { success: true };
  }

  const connection = await getStorageConnectionById(connectionId);
  if (!connection) throw new Error('Konfigurace externího úložiště nebyla nalezena.');
  const { data, error } = await invokeDocumentStorage({
    body: {
      action: 'downloadUrl',
      connectionId: connection.id,
      provider: connection.provider,
      entityType,
      entityId,
      fileId,
      accessEntityType,
      accessEntityId,
    },
  });
  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || 'Soubor se nepodařilo načíst.');
  const url = data?.downloadUrl || data?.webUrl;
  if (!url) throw new Error('Úložiště nevrátilo odkaz pro stažení souboru.');
  window.open(url, '_blank', 'noopener,noreferrer');
  return { success: true };
};

export const deleteStoredFile = async ({
  provider = 'supabase',
  connectionId,
  bucket,
  filePath,
  fileId,
  entityType,
  entityId,
  accessEntityType,
  accessEntityId,
}) => {
  if (provider === 'supabase' || !connectionId) {
    const targetBucket = bucket || (entityType === 'invoice' ? INVOICE_BUCKET : PROJECT_BUCKET);
    const targetPath = normalizeBucketPath(filePath || fileId, targetBucket);
    if (!targetPath) return { success: true, skipped: true };
    const { error } = await supabase.storage.from(targetBucket).remove([targetPath]);
    if (error) throw error;
    return { success: true };
  }

  const connection = await getStorageConnectionById(connectionId);
  if (!connection) throw new Error('Konfigurace externiho uloziste nebyla nalezena.');
  return deleteExternalStorageFile({
    connection,
    entityType,
    entityId,
    fileId,
    accessEntityType,
    accessEntityId,
  });
};

export const storageProviderLabels = {
  supabase: 'Supabase Storage',
  sharepoint: 'SharePoint',
  google_drive: 'Google Drive',
};
