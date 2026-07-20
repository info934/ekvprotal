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

  const { data, error } = await supabase
    .from('document_storage_folders')
    .upsert({
      connection_id: connection.id,
      entity_type: entityType,
      entity_id: entityId,
      folder_path: folderPath,
      external_folder_id: externalFolderId,
      external_web_url: externalWebUrl,
      status,
      metadata,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'connection_id,entity_type,entity_id' })
    .select('*')
    .single();

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

  await persistFolderMapping({
    connection: activeConnection,
    entityType,
    entityId,
    folderPath,
    externalFolderId: data.externalFolderId || data.folderId,
    externalWebUrl: data.webUrl,
    status: data.status || 'created',
    metadata: data.metadata || {},
  });

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

  if (connection.provider === 'supabase') {
    const fileExt = file.name.split('.').pop();
    const safeName = sanitizePathSegment(documentName || file.name);
    const filePath = `${project.id}/${folder.folderPath}/${safeName}_${Date.now()}.${fileExt}`;
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
        storage_metadata: { bucket: PROJECT_BUCKET, folderPath: folder.folderPath },
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
      fileName: file.name,
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
  await ensureEntityFolder({
    entityType: 'project',
    entityId: project.id,
    code: project.code,
    name: project.name,
    connection,
  });
  const now = new Date();
  const uploadDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const projectReference = sanitizePathSegment(project.code || project.id);
  const storedFileName = `${uploadDate}_${projectReference}_${sanitizePathSegment(costId)}_${sanitizePathSegment(file.name)}`;
  const invoiceFolderPath = `${buildEntityFolderPath({
    entityType: 'project',
    entityId: project.id,
    code: project.code,
    name: project.name,
  })}/04_Fakturace`;

  if (connection.provider === 'supabase') {
    const filePath = `${project.id}/04_Fakturace/${storedFileName}`;
    const { error } = await supabase.storage
      .from(PROJECT_BUCKET)
      .upload(filePath, file, { cacheControl: '3600', upsert: false });
    if (error) throw error;
    const { data: publicData } = supabase.storage.from(PROJECT_BUCKET).getPublicUrl(filePath);

    return {
      provider: 'supabase',
      connectionId: connection.id,
      dbUrl: publicData.publicUrl,
      filePath,
      fileName: file.name,
      storageFields: {
        invoice_url: publicData.publicUrl,
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
        `Odkaz-${projectReference}-${sanitizePathSegment(file.name)}.url`,
        { type: 'application/internet-shortcut' },
      );
      centralLink = await uploadInvoiceDocument({
        file: shortcut,
        recordId: costId,
        projectReference: project.code || project.id,
        category: 'odkaz-projektovy-naklad',
        connection,
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

const getFolderCacheKey = ({ entityType, folderId, connection }) =>
  `${connection?.id || connection?.provider || 'storage'}:${entityType}:${folderId}`;

export const invalidateEntityStorageFolderCache = ({ entityType, folderId, connection }) => {
  folderListCache.delete(getFolderCacheKey({ entityType, folderId, connection }));
};

const listEntityStorageFolderUncached = async ({ entityType, folderId, connection }) => {
  if (!connection || connection.provider === 'supabase') {
    return { items: [], provider: connection?.provider || 'supabase', supported: false };
  }

  const { data, error } = await supabase.functions.invoke('document-storage', {
    body: {
      action: 'listFiles',
      connectionId: connection.id,
      provider: connection.provider,
      entityType,
      folderId,
    },
  });

  if (error) throw error;
  if (data?.success === false) throw new Error(data.error || 'Obsah složky se nepodařilo načíst.');
  return { items: data.items || [], provider: connection.provider, supported: true };
};

export const listEntityStorageFolder = async ({ entityType, folderId, connection, forceRefresh = false }) => {
  const cacheKey = getFolderCacheKey({ entityType, folderId, connection });
  const cached = folderListCache.get(cacheKey);
  if (!forceRefresh && cached?.expiresAt > Date.now()) return cached.value;
  if (!forceRefresh && folderListRequests.has(cacheKey)) return folderListRequests.get(cacheKey);

  const request = listEntityStorageFolderUncached({ entityType, folderId, connection })
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
  invalidateEntityStorageFolderCache({ entityType, folderId, connection });
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
}) => {
  const connection = providedConnection || await getDefaultStorageConnection();
  const now = new Date();
  const uploadDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const safeRecordId = sanitizePathSegment(recordId);
  const safeProjectReference = sanitizePathSegment(projectReference || recordId);
  const safeFileName = sanitizePathSegment(file.name);
  const folderPath = '';
  const recordSuffix = safeRecordId === safeProjectReference ? '' : `_${safeRecordId}`;
  const storedFileName = `${uploadDate}_${safeProjectReference}${recordSuffix}_${safeFileName}`;

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

export const downloadProjectDocument = async (document) => {
  if (document.external_web_url && document.storage_provider !== 'supabase') {
    window.open(document.external_web_url, '_blank', 'noopener,noreferrer');
    return;
  }

  if (!document.file_path) {
    throw new Error('Cesta k souboru neni definovana.');
  }

  const { data, error } = await supabase.storage.from(PROJECT_BUCKET).download(document.file_path);
  if (error) throw error;

  const blob = new Blob([data]);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = document.file_name || 'document';
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
};

export const storageProviderLabels = {
  supabase: 'Supabase Storage',
  sharepoint: 'SharePoint',
  google_drive: 'Google Drive',
};
