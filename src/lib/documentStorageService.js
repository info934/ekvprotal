import { supabase } from '@/lib/customSupabaseClient';

const PROJECT_BUCKET = 'project-files';
const INVOICE_BUCKET = 'invoices';
const PRODUCT_DATASHEET_FOLDER = 'product-datasheets';
const DEFAULT_CONNECTION_CACHE_TTL = 5 * 60 * 1000;
const FOLDER_LIST_CACHE_TTL = 60 * 1000;

let defaultConnectionCache = null;
let defaultConnectionPromise = null;
const folderListCache = new Map();
const folderListRequests = new Map();

const MISSING_STORAGE_CONFIG_CODES = new Set(['42P01', '42703', 'PGRST116', 'PGRST204', 'PGRST205']);

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
  .replace(/^-+|-+$/g, '')
  .slice(0, 90) || 'item';

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
  const label = [code, name].filter(Boolean).join(' - ');
  return `${root}/${sanitizePathSegment(label || entityId)}`;
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

  const { data: existingMapping, error: existingMappingError } = activeConnection.id
    ? await supabase
      .from('document_storage_folders')
      .select('*')
      .eq('connection_id', activeConnection.id)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .maybeSingle()
    : { data: null, error: null };
  if (existingMappingError && !isStorageConfigMissingError(existingMappingError)) throw existingMappingError;

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

  const { data, error } = await supabase.functions.invoke('document-storage', {
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

  const fileBase64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const { data, error } = await supabase.functions.invoke('document-storage', {
    body: {
      action: 'uploadFile',
      connectionId: connection.id,
      provider: connection.provider,
      entityType: 'project',
      entityId: project.id,
      folderId: folder.externalFolderId,
      folderPath: folder.folderPath,
      fileName: storedFileName,
      contentType: file.type || 'application/octet-stream',
      fileBase64,
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

export const uploadProjectCostInvoice = async ({ file, project, costId, createCentralLink = true }) => {
  const connection = await getDefaultStorageConnection();
  const configuredInvoiceFolder = sanitizeRelativeFolderPath(
    connection.config?.targets?.project?.costInvoiceFolderPath,
    '04_Fakturace',
  );
  await ensureEntityFolder({
    entityType: 'project',
    entityId: project.id,
    code: project.code,
    name: project.name,
    connection,
  });
  const projectReference = String(project.code || '').trim();
  const storedFileName = buildStoredFileName(file.name, projectReference, costId);
  const invoiceFolderPath = `${buildEntityFolderPath({
    entityType: 'project',
    entityId: project.id,
    code: project.code,
    name: project.name,
  })}/${configuredInvoiceFolder}`;

  if (connection.provider === 'supabase') {
    const filePath = `${project.id}/${configuredInvoiceFolder}/${storedFileName}`;
    const { error } = await supabase.storage
      .from(PROJECT_BUCKET)
      .upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    return {
      provider: 'supabase',
      connectionId: connection.id,
      dbUrl: `${PROJECT_BUCKET}/${filePath}`,
      filePath,
      fileName: file.name,
      storageFields: {
        invoice_url: `${PROJECT_BUCKET}/${filePath}`,
        invoice_name: file.name,
        invoice_storage_provider: 'supabase',
        invoice_storage_connection_id: connection.id,
        invoice_external_file_id: filePath,
        invoice_external_web_url: null,
        invoice_storage_metadata: { bucket: PROJECT_BUCKET, folderPath: invoiceFolderPath },
      },
      cleanup: async () => supabase.storage.from(PROJECT_BUCKET).remove([filePath]),
    };
  }

  const { data, error } = await supabase.functions.invoke('document-storage', {
    body: {
      action: 'uploadFile',
      connectionId: connection.id,
      provider: connection.provider,
      entityType: 'project',
      entityId: project.id,
      folderPath: invoiceFolderPath,
      fileName: storedFileName,
      contentType: file.type || 'application/octet-stream',
      fileBase64: await fileToBase64(file),
      metadata: { documentKind: 'project_cost_invoice', costId, originalFileName: file.name },
    },
  });

  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || 'Fakturu se nepodařilo nahrát do projektové složky.');

  let centralLink = null;
  let centralLinkError = null;
  if (createCentralLink && data.webUrl) {
    try {
      const shortcut = new File(
        [`[InternetShortcut]\r\nURL=${data.webUrl}\r\n`],
        `Odkaz - ${storedFileName}.url`,
        { type: 'application/internet-shortcut' },
      );
      centralLink = await uploadInvoiceDocument({
        file: shortcut,
        recordId: costId,
        projectReference: project.code || null,
        category: 'odkaz-projektovy-naklad',
        connection,
        accessEntityType: 'project',
        accessEntityId: project.id,
      });
    } catch (linkError) {
      centralLinkError = linkError.message || 'Centrální odkaz se nepodařilo vytvořit.';
    }
  }

  return {
    provider: connection.provider,
    connectionId: connection.id,
    dbUrl: data.webUrl,
    filePath: data.filePath,
    fileId: data.fileId,
    webUrl: data.webUrl,
    fileName: file.name,
    centralLink,
    centralLinkError,
    storageFields: {
      invoice_url: data.webUrl,
      invoice_name: file.name,
      invoice_storage_provider: connection.provider,
      invoice_storage_connection_id: connection.id,
      invoice_external_file_id: data.fileId,
      invoice_external_web_url: data.webUrl,
      invoice_storage_metadata: {
        ...(data.metadata || {}),
        folderPath: invoiceFolderPath,
        centralLinkFileId: centralLink?.fileId || null,
        centralLinkWebUrl: centralLink?.webUrl || null,
        centralLinkError,
      },
    },
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

  const { data, error } = await supabase.functions.invoke('document-storage', {
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

  const { data, error } = await supabase.functions.invoke('document-storage', {
    body: {
      action: 'uploadFile',
      connectionId: connection.id,
      provider: connection.provider,
      entityType,
      entityId,
      folderId,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      fileBase64: await fileToBase64(file),
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

  const { data, error } = await supabase.functions.invoke('document-storage', {
    body: {
      action: 'uploadFile',
      connectionId: connection.id,
      provider: connection.provider,
      entityType: 'product',
      entityId: product.id,
      folderId: folder.externalFolderId,
      folderPath: folder.folderPath,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      fileBase64: await fileToBase64(file),
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
  const folderPath = '';
  const storedFileName = projectReference
    ? buildStoredFileName(readableFileName, projectReference, recordId)
    : `${uploadDate}_${safeRecordId}_${readableFileName}`;

  if (connection.provider === 'supabase') {
    const filePath = storedFileName;
    const { error } = await supabase.storage
      .from(INVOICE_BUCKET)
      .upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;

    return {
      provider: 'supabase',
      connectionId: connection.id,
      dbUrl: `${INVOICE_BUCKET}/${filePath}`,
      filePath,
      fileName: file.name,
      cleanup: async () => supabase.storage.from(INVOICE_BUCKET).remove([filePath]),
    };
  }

  const { data, error } = await supabase.functions.invoke('document-storage', {
    body: {
      action: 'uploadFile',
      connectionId: connection.id,
      provider: connection.provider,
      entityType: 'invoice',
      entityId: recordId,
      accessEntityType,
      accessEntityId,
      folderPath,
      fileName: storedFileName,
      contentType: file.type || 'application/octet-stream',
      fileBase64: await fileToBase64(file),
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
    metadata: data.metadata || {},
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
  const { data, error } = await supabase.functions.invoke('document-storage', {
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
  const { data, error } = await supabase.functions.invoke('document-storage', {
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
