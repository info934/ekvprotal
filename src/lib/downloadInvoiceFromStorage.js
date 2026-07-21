import { downloadStoredFile } from '@/lib/documentStorageService';

/**
 * Downloads a financial document without exposing a permanent public URL.
 * Accepts a legacy URL/path or a complete storage descriptor.
 */
export const downloadInvoiceFromStorage = async (invoice) => {
  const descriptor = typeof invoice === 'string'
    ? { filePath: invoice }
    : (invoice || {});
  const filePath = descriptor.filePath || descriptor.invoice_url;

  if (!filePath && !descriptor.fileId) {
    return { success: false, error: 'Chybí cesta k souboru faktury.' };
  }

  try {
    if (
      typeof filePath === 'string'
      && /^https?:\/\//i.test(filePath)
      && !filePath.includes('/storage/v1/object/')
      && (!descriptor.provider || descriptor.provider === 'supabase')
    ) {
      window.open(filePath, '_blank', 'noopener,noreferrer');
      return { success: true };
    }

    await downloadStoredFile({
      provider: descriptor.provider || descriptor.invoice_storage_provider || 'supabase',
      connectionId: descriptor.connectionId || descriptor.invoice_storage_connection_id,
      bucket: descriptor.bucket || descriptor.storageMetadata?.bucket || descriptor.invoice_storage_metadata?.bucket,
      filePath,
      fileId: descriptor.fileId || descriptor.invoice_external_file_id,
      fileName: descriptor.fileName || descriptor.invoice_name,
      entityType: descriptor.entityType || 'invoice',
      entityId: descriptor.entityId,
      accessEntityType: descriptor.accessEntityType,
      accessEntityId: descriptor.accessEntityId,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Nepodařilo se stáhnout soubor. Zkontrolujte, zda existuje.',
    };
  }
};
