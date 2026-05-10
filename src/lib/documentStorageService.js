import { supabase } from '@/lib/customSupabaseClient';

const PROJECT_BUCKET = 'project-files';
const INVOICE_BUCKET = 'invoices';
const PRODUCT_DATASHEET_FOLDER = 'product-datasheets';

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
  const { data, error } = await supabase
    .from('document_storage_connections')
    .select('*')
    .eq('is_default', true)
    .maybeSingle();

  if (error) {
    if (isStorageConfigMissingError(error)) return fallbackConnection;
    throw error;
  }

  return data || fallbackConnection;
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
