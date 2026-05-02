import { supabase } from '@/lib/customSupabaseClient';

/**
 * Utility function to download an invoice from Supabase Storage
 * @param {string} invoiceUrl - The full URL or relative path to the file
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const downloadInvoiceFromStorage = async (invoiceUrl) => {
    console.log('[downloadInvoiceFromStorage] 1. Initial Input URL:', invoiceUrl);
    
    if (!invoiceUrl) {
        console.warn('[downloadInvoiceFromStorage] Error: No invoice URL provided');
        return { success: false, error: 'Chybí cesta k souboru faktury.' };
    }

    try {
        let filePath = invoiceUrl;
        let bucket = 'invoices';

        // 1. Strip out full URL domains if present
        if (filePath.includes('/storage/v1/object/public/')) {
            filePath = filePath.split('/storage/v1/object/public/')[1];
        } else if (filePath.includes('/storage/v1/object/sign/')) {
            filePath = filePath.split('/storage/v1/object/sign/')[1];
            // Remove query params from signed URL
            filePath = filePath.split('?')[0]; 
        }

        // 2. Extract bucket from path if it's explicitly there
        // Format might be "invoices/2026/03/filename.pdf"
        if (filePath.startsWith('invoices/')) {
            filePath = filePath.replace('invoices/', '');
            bucket = 'invoices';
        }

        console.log(`[downloadInvoiceFromStorage] 2. Parsed Bucket: "${bucket}", Parsed Path: "${filePath}"`);

        // 3. Download from Supabase
        console.log(`[downloadInvoiceFromStorage] 3. Calling supabase.storage.from('${bucket}').download('${filePath}')`);
        const { data, error } = await supabase.storage
            .from(bucket)
            .download(filePath);

        if (error) {
            console.error('[downloadInvoiceFromStorage] 4. Supabase storage error:', error);
            throw error;
        }

        if (!data) {
            console.error('[downloadInvoiceFromStorage] 4. No data received from storage.');
            throw new Error("Ze serveru nebyla přijata žádná data.");
        }

        // 4. Extract filename for the download link
        const cleanPath = filePath.split('?')[0] || '';
        const fileName = cleanPath.split('/').pop() || 'faktura';
        
        console.log(`[downloadInvoiceFromStorage] 5. Creating blob for filename: ${fileName}, size: ${data.size} bytes`);

        // 5. Trigger browser download
        const blobUrl = window.URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        
        // Cleanup safely
        setTimeout(() => {
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
            console.log('[downloadInvoiceFromStorage] 6. Cleanup completed.');
        }, 150);

        return { success: true };
    } catch (error) {
        console.error('[downloadInvoiceFromStorage] Caught Exception:', error);
        return { success: false, error: error.message || 'Nepodařilo se stáhnout soubor. Zkontrolujte, zda existuje.' };
    }
};