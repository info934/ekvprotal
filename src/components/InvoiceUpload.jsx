import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud, File, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { motion } from 'framer-motion';
import { logPayoutAction } from '@/lib/payoutLogger';
import { sendAdminPayoutNotification } from '@/lib/payoutEmailService';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_RETRIES = 3;

const InvoiceUpload = ({ requestId, memberId, onUploadSuccess }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { toast } = useToast();

  const onDrop = useCallback(async (acceptedFiles, fileRejections) => {
    if (fileRejections.length > 0) {
      const error = fileRejections[0].errors[0];
      toast({
        title: "Chyba při výběru souboru",
        description: error.code === 'file-too-large' ? "Soubor je příliš velký (max 10MB)" : "Nepodporovaný typ souboru.",
        variant: "destructive"
      });
      return;
    }

    const file = acceptedFiles[0];
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(10);
    
    await logPayoutAction('invoice_upload_attempt', requestId, { fileName: file.name, fileSize: file.size });

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `invoice_${memberId}_${requestId}_${Date.now()}.${fileExt}`;
      
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      
      const bucketName = 'invoices';
      const filePath = `${year}/${month}/${fileName}`;
      const dbUrlPath = `${bucketName}/${filePath}`;

      setUploadProgress(30);

      // Upload to storage with retry logic
      let uploadError = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const { error } = await supabase.storage
          .from(bucketName)
          .upload(filePath, file, {
            cacheControl: '3600',
            upsert: true
          });
        
        uploadError = error;
        if (!error) break;
        
        console.warn(`[InvoiceUpload] Upload attempt ${attempt} failed:`, error);
        if (attempt < MAX_RETRIES) {
           await new Promise(res => setTimeout(res, 1000 * attempt)); // Exponential backoff
        }
      }

      if (uploadError) {
        console.error("[InvoiceUpload] Final storage upload error:", uploadError);
        throw uploadError;
      }

      setUploadProgress(80);

      // Update database record
      const updateData = { 
        invoice_url: dbUrlPath,
        invoice_uploaded_at: new Date().toISOString(),
        status: 'invoice_uploaded' // Ensure status advances
      };

      const { data: dbData, error: dbError } = await supabase
        .from('hourly_payout_requests')
        .update(updateData)
        .eq('id', requestId)
        .select('*, members:members!hourly_payout_requests_member_id_fkey(name)')
        .single();

      if (dbError) {
          console.error("[InvoiceUpload] Database update error:", dbError);
          // Attempt rollback if DB fails
          await supabase.storage.from(bucketName).remove([filePath]).catch(console.error);
          throw dbError;
      }

      await logPayoutAction('invoice_upload_success', requestId, { dbUrlPath });

      const emailResult = await sendAdminPayoutNotification({
        memberName: dbData?.members?.name || 'Pracovnik',
        amount: dbData?.total_amount || 0,
        action: 'Faktura nahrana k hodinove zadosti'
      });

      if (!emailResult.success) {
        console.error('[InvoiceUpload] Admin notification failed:', emailResult.error);
      }

      setUploadProgress(100);
      toast({
        title: "Faktura nahrána",
        description: "Vaše faktura byla úspěšně nahrána do systému.",
      });

      if (onUploadSuccess) onUploadSuccess(dbUrlPath);

    } catch (error) {
      console.error("[InvoiceUpload] Caught error during upload process:", error);
      await logPayoutAction('invoice_upload_failure', requestId, { error: error.message || error });
      
      toast({
        title: "Chyba nahrávání",
        description: "Při nahrávání faktury došlo k chybě. Zkontrolujte prosím připojení a zkuste to znovu.",
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [requestId, memberId, onUploadSuccess, toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png']
    },
    maxSize: MAX_FILE_SIZE,
    maxFiles: 1,
    disabled: isUploading
  });

  return (
    <div className="w-full">
      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200 cursor-pointer flex flex-col items-center justify-center gap-3
          ${isDragActive ? 'border-primary bg-primary/5' : 'border-slate-300 hover:border-primary/50 hover:bg-slate-50'}
          ${isUploading ? 'opacity-50 pointer-events-none' : ''}
        `}
      >
        <input {...getInputProps()} />
        
        {isUploading ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center">
            <Loader2 className="w-10 h-10 text-primary animate-spin mb-2" />
            <p className="text-sm font-medium text-slate-700">Nahrávám fakturu...</p>
            <div className="w-48 h-2 bg-slate-200 rounded-full mt-3 overflow-hidden">
                <div 
                    className="h-full bg-primary transition-all duration-300 ease-out" 
                    style={{ width: `${uploadProgress}%` }}
                />
            </div>
          </motion.div>
        ) : (
          <>
            <div className="p-4 bg-slate-100 rounded-full text-slate-500 mb-2">
              <UploadCloud className="w-8 h-8" />
            </div>
            <div>
              <p className="font-semibold text-slate-800">
                {isDragActive ? 'Přetáhněte soubor sem' : 'Klikněte nebo přetáhněte fakturu sem'}
              </p>
              <p className="text-xs text-slate-500 mt-1">Podporováno: PDF, JPG, PNG (max 10MB)</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default InvoiceUpload;
