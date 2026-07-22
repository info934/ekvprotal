import React, { useEffect, useState } from 'react';
import { AlertCircle, Download, FileText, Image as ImageIcon, Loader2, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import ConfirmActionDialog from '@/components/ui/confirm-action-dialog';
import { useToast } from '@/components/ui/use-toast';
import { deleteStoredFile } from '@/lib/documentStorageService';
import { downloadInvoiceFromStorage } from '@/lib/downloadInvoiceFromStorage';
import { clearHourlyPayoutInvoice } from '@/lib/hourlyPayoutWorkflowService';
import { logPayoutAction } from '@/lib/payoutLogger';

const InvoicePreview = ({
  invoicePath,
  invoiceName,
  uploadedAt,
  status,
  requestId,
  storageProvider,
  storageConnectionId,
  externalFileId,
  storageMetadata,
  onDelete,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorLoading, setErrorLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { toast } = useToast();

  const isPdf = invoicePath?.toLowerCase().endsWith('.pdf');
  const cleanPath = invoicePath?.split('?')[0] || '';
  const fileName = invoiceName || storageMetadata?.originalFileName || cleanPath.split('/').pop() || 'faktura';

  useEffect(() => {
    if (!invoicePath) setErrorLoading(true);
  }, [invoicePath]);

  const handleDownload = async (event) => {
    event?.stopPropagation();
    if (!invoicePath || isDownloading) return;

    setIsDownloading(true);
    const { success, error } = await downloadInvoiceFromStorage({
      provider: storageProvider,
      connectionId: storageConnectionId,
      bucket: storageMetadata?.bucket || 'invoices',
      filePath: invoicePath,
      fileId: externalFileId,
      fileName,
      entityType: 'invoice',
      entityId: requestId,
      accessEntityType: 'hourly_payout',
      accessEntityId: requestId,
    });

    toast(success
      ? { title: 'Staženo', description: 'Soubor byl úspěšně stažen.' }
      : { title: 'Chyba stahování', description: error || 'Soubor se nepodařilo stáhnout.', variant: 'destructive' });
    setIsDownloading(false);
  };

  const handleDelete = async (event) => {
    event?.stopPropagation();
    setIsDeleting(true);
    await logPayoutAction('invoice_delete_attempt', requestId, { invoicePath });

    try {
      // Keep the database reference until physical deletion succeeds. A failed
      // storage operation can then be retried without losing the file identity.
      await deleteStoredFile({
        provider: storageProvider,
        connectionId: storageConnectionId,
        bucket: storageMetadata?.bucket || 'invoices',
        filePath: invoicePath,
        fileId: externalFileId,
        entityType: 'invoice',
        entityId: requestId,
        accessEntityType: 'hourly_payout',
        accessEntityId: requestId,
      });
      await clearHourlyPayoutInvoice(requestId);
      await logPayoutAction('invoice_delete_success', requestId, { invoicePath });
      toast({ title: 'Smazáno', description: 'Faktura byla odstraněna z evidence i úložiště.' });
      setDeleteDialogOpen(false);
      onDelete?.();
    } catch (error) {
      console.error('[InvoicePreview] Error deleting invoice:', error);
      await logPayoutAction('invoice_delete_failure', requestId, { error: error.message });
      toast({
        title: 'Fakturu se nepodařilo odstranit',
        description: error.message || 'Zkuste operaci znovu.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (!invoicePath) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="group flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4 transition-colors hover:border-blue-300">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-4 text-left"
          onClick={handleDownload}
          title="Kliknutím stáhnete fakturu"
        >
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg transition-colors ${errorLoading ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600 group-hover:bg-blue-200'}`}>
            {errorLoading
              ? <AlertCircle className="h-6 w-6" />
              : isPdf
                ? <FileText className="h-6 w-6" />
                : <ImageIcon className="h-6 w-6" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-slate-800 transition-colors group-hover:text-blue-700" title={fileName}>{fileName}</span>
            <span className="block text-xs text-slate-500">
              {errorLoading
                ? 'Neplatná cesta k souboru'
                : `Nahráno: ${uploadedAt ? format(new Date(uploadedAt), 'dd. MM. yyyy HH:mm', { locale: cs }) : 'Neznámé datum'}`}
            </span>
          </span>
        </button>

        <div className="ml-4 flex shrink-0 items-center gap-2">
          {!errorLoading && (
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={isDownloading} className="gap-2">
              {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">{isDownloading ? 'Stahuji...' : 'Stáhnout'}</span>
            </Button>
          )}
          {status !== 'paid' && (
            <Button
              variant="ghost"
              size="icon"
              className="text-red-500 hover:bg-red-50 hover:text-red-700"
              onClick={(event) => {
                event.stopPropagation();
                setDeleteDialogOpen(true);
              }}
              disabled={isDeleting}
              title="Smazat fakturu"
              aria-label="Smazat fakturu"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>

      <ConfirmActionDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Smazat fakturu?"
        description="Faktura bude odstraněna z připojeného úložiště a potom z evidence žádosti. Uhrazenou fakturu odstranit nelze."
        confirmLabel="Smazat fakturu"
        destructive
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
};

export default InvoicePreview;
