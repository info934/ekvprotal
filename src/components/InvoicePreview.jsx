import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { FileText, Download, Trash2, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import { useToast } from '@/components/ui/use-toast';
import { logPayoutAction } from '@/lib/payoutLogger';
import { downloadInvoiceFromStorage } from '@/lib/downloadInvoiceFromStorage';

const InvoicePreview = ({ invoicePath, uploadedAt, status, requestId, onDelete }) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [errorLoading, setErrorLoading] = useState(false);
  const { toast } = useToast();

  const isPdf = invoicePath?.toLowerCase().endsWith('.pdf');
  const cleanPath = invoicePath?.split('?')[0] || '';
  const fileName = cleanPath.split('/').pop() || 'faktura';

  useEffect(() => {
    console.log('[InvoicePreview] Mounted with raw invoice_url:', invoicePath);
    if (!invoicePath) {
      setErrorLoading(true);
    }
  }, [invoicePath]);

  const handleDownload = async (e) => {
    if (e) e.stopPropagation();
    if (!invoicePath || isDownloading) return;
    
    console.log('[InvoicePreview] User clicked download. Calling downloadInvoiceFromStorage with:', invoicePath);
    setIsDownloading(true);
    
    const { success, error } = await downloadInvoiceFromStorage(invoicePath);
    
    if (success) {
        console.log('[InvoicePreview] Download successful.');
        toast({ title: "Staženo", description: "Soubor byl úspěšně stažen." });
    } else {
        console.error('[InvoicePreview] Download failed:', error);
        toast({ 
            title: "Chyba stahování", 
            description: error || "Nepodařilo se stáhnout soubor.", 
            variant: "destructive" 
        });
    }
    
    setIsDownloading(false);
  };

  const handleDelete = async (e) => {
    if (e) e.stopPropagation();
    if (!window.confirm("Opravdu chcete smazat tuto fakturu?")) return;
    
    setIsDeleting(true);
    await logPayoutAction('invoice_delete_attempt', requestId, { invoicePath });
    
    try {
      // Determine bucket and path for deletion
      let pathToDelete = invoicePath;
      let bucket = 'invoices';
      
      if (pathToDelete.startsWith('invoices/')) {
          pathToDelete = pathToDelete.replace('invoices/', '');
      } else if (pathToDelete.includes('/storage/v1/object/public/invoices/')) {
          pathToDelete = pathToDelete.split('/storage/v1/object/public/invoices/')[1];
      }

      console.log(`[InvoicePreview] Deleting from bucket "${bucket}", path: "${pathToDelete}"`);

      const { error: storageError } = await supabase.storage
        .from(bucket)
        .remove([pathToDelete]);

      if (storageError) {
          console.error("[InvoicePreview] Storage delete error:", storageError);
      }

      const { error: dbError } = await supabase
        .from('hourly_payout_requests')
        .update({ 
            invoice_url: null, 
            invoice_uploaded_at: null 
        })
        .eq('id', requestId);

      if (dbError) throw dbError;

      await logPayoutAction('invoice_delete_success', requestId, { invoicePath });
      toast({ title: "Smazáno", description: "Faktura byla odstraněna." });
      if (onDelete) onDelete();

    } catch (error) {
      console.error("[InvoicePreview] Error deleting invoice:", error);
      await logPayoutAction('invoice_delete_failure', requestId, { error: error.message });
      toast({ 
          title: "Chyba", 
          description: "Nepodařilo se smazat fakturu.", 
          variant: "destructive" 
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (!invoicePath) return null;

  return (
    <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between p-4 border border-slate-200 rounded-xl bg-slate-50 hover:border-blue-300 transition-colors group">
        <div 
            className="flex items-center gap-4 cursor-pointer flex-1 min-w-0"
            onClick={handleDownload}
            title="Kliknutím stáhnete fakturu"
        >
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 transition-colors ${errorLoading ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600 group-hover:bg-blue-200'}`}>
            {errorLoading ? <AlertCircle className="w-6 h-6" /> : (isPdf ? <FileText className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />)}
            </div>
            <div className="min-w-0">
            <p className="font-medium text-slate-800 truncate group-hover:text-blue-700 transition-colors" title={fileName}>{fileName}</p>
            <p className="text-xs text-slate-500">
                {errorLoading ? 'Neplatná cesta k souboru' : `Nahráno: ${uploadedAt ? format(new Date(uploadedAt), 'dd. MM. yyyy HH:mm', { locale: cs }) : 'Neznámé datum'}`}
            </p>
            </div>
        </div>
        
        <div className="flex items-center gap-2 shrink-0 ml-4">
            {!errorLoading && (
            <Button 
                variant="outline" 
                size="sm" 
                onClick={handleDownload}
                disabled={isDownloading}
                className="gap-2"
            >
                {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span className="hidden sm:inline">{isDownloading ? 'Stahuji...' : 'Stáhnout'}</span>
            </Button>
            )}
            
            {status !== 'paid' && (
            <Button 
                variant="ghost" 
                size="icon" 
                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                onClick={handleDelete}
                disabled={isDeleting}
                title="Smazat fakturu"
            >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </Button>
            )}
        </div>
        </div>
        
        <div className="text-[10px] text-slate-400 font-mono pl-1 break-all">
            Debug path: {invoicePath}
        </div>
    </div>
  );
};

export default InvoicePreview;