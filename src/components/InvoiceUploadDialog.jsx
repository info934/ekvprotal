/**
 * TASK 7: Invoice Upload Dialog Component
 * 
 * Allows users to upload invoice files for approved payout requests
 * - Drag & drop or file picker
 * - PDF, JPG, PNG files only
 * - Max 10MB file size
 * - Upload to Supabase storage
 * - Shows upload progress
 */

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { uploadInvoice } from '@/lib/payoutWorkflowService';
import { sendInvoiceUploadedNotification } from '@/lib/payoutWorkflowEmailService';
import { Upload, File, X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { uploadInvoiceDocument } from '@/lib/documentStorageService';

const InvoiceUploadDialog = ({ isOpen, onClose, payout, onSuccess }) => {
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);

  const maxSize = 10 * 1024 * 1024; // 10MB
  const acceptedFileTypes = {
    'application/pdf': ['.pdf'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png']
  };

  const onDrop = useCallback((acceptedFiles, rejectedFiles) => {
    setError(null);
    
    if (rejectedFiles.length > 0) {
      const rejection = rejectedFiles[0];
      if (rejection.file.size > maxSize) {
        setError('Soubor je příliš velký. Maximální velikost je 10MB.');
      } else {
        setError('Nepodporovaný typ souboru. Povolené jsou pouze PDF, JPG a PNG.');
      }
      return;
    }

    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
      setError(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: acceptedFileTypes,
    maxSize,
    multiple: false,
    disabled: uploading
  });

  const handleUpload = async () => {
    if (!selectedFile || !payout) return;

    setUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      clearInterval(progressInterval);
      const storedInvoice = await uploadInvoiceDocument({
        file: selectedFile,
        recordId: payout.id,
        projectReference: payout.payout_items?.find((item) => item.projects?.code)?.projects?.code
          || payout.payout_items?.find((item) => item.project_id)?.project_id,
        category: 'ukolove-vyplaty',
      });

      setUploadProgress(95);

      const publicUrl = storedInvoice.dbUrl;
      const fileName = selectedFile.name;

      console.log('[InvoiceUpload] File uploaded, updating payout record...');

      // Update payout record with invoice details
      const result = await uploadInvoice(payout.id, publicUrl, fileName);

      if (!result.success) throw new Error(result.error);

      setUploadProgress(100);

      // Send notification to admin. Keep the payout shape expected by the email service.
      const emailResult = await sendInvoiceUploadedNotification({
        ...payout,
        invoice_url: publicUrl,
        invoice_name: fileName,
        invoice_uploaded_at: new Date().toISOString()
      });

      if (!emailResult.success) {
        console.error('[InvoiceUpload] Admin notification failed:', emailResult.error);
      }
      console.log('[InvoiceUpload] Upload complete, notifications sent');

      toast({
        title: 'Faktura nahrána',
        description: 'Faktura byla úspěšně nahrána a čeká na potvrzení administrátorem.'
      });

      // Reset state
      setSelectedFile(null);
      setUploadProgress(0);
      setUploading(false);

      if (onSuccess) onSuccess();
      onClose();

    } catch (err) {
      console.error('[InvoiceUpload] Upload error:', err);
      setError(err.message || 'Nepodařilo se nahrát fakturu. Zkuste to prosím znovu.');
      setUploading(false);
      setUploadProgress(0);
      
      toast({
        title: 'Chyba nahrávání',
        description: err.message || 'Nepodařilo se nahrát fakturu.',
        variant: 'destructive'
      });
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setSelectedFile(null);
      setError(null);
      setUploadProgress(0);
      onClose();
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <FormDialogContent size="sm">
        <FormDialogHeader
          icon={Upload}
          title="Nahrát fakturu"
          description={<>Nahrajte fakturu pro žádost o výplatu ve výši <strong>{payout?.amount?.toLocaleString('cs-CZ')} Kč</strong></>}
        />

        <FormDialogBody className="space-y-4">
          {/* File dropzone */}
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all",
              isDragActive ? "border-primary bg-primary/5" : "border-gray-300 hover:border-primary hover:bg-gray-50",
              uploading && "opacity-50 cursor-not-allowed",
              error && "border-red-300 bg-red-50"
            )}
          >
            <input {...getInputProps()} />
            
            {selectedFile ? (
              <div className="flex items-center justify-center gap-3">
                <File className="w-8 h-8 text-primary" />
                <div className="text-left flex-1">
                  <p className="font-medium text-sm truncate">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
                </div>
                {!uploading && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      setError(null);
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ) : (
              <>
                <Upload className={cn(
                  "w-12 h-12 mx-auto mb-3",
                  isDragActive ? "text-primary" : "text-gray-400"
                )} />
                <p className="text-sm font-medium text-gray-700 mb-1">
                  {isDragActive ? 'Přetáhněte soubor sem...' : 'Klikněte nebo přetáhněte soubor'}
                </p>
                <p className="text-xs text-muted-foreground">
                  PDF, JPG nebo PNG (max. 10MB)
                </p>
              </>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Upload progress */}
          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Nahrávání...</span>
                <span className="font-medium">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}

          {/* Success message */}
          {uploadProgress === 100 && !uploading && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-md">
              <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
              <p className="text-sm text-green-600">Faktura byla úspěšně nahrána!</p>
            </div>
          )}
        </FormDialogBody>

        <FormDialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={uploading}
          >
            Zrušit
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Nahrávám...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Nahrát fakturu
              </>
            )}
          </Button>
        </FormDialogFooter>
      </FormDialogContent>
    </Dialog>
  );
};

export default InvoiceUploadDialog;
