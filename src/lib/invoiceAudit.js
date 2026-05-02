import { supabase } from '@/lib/customSupabaseClient';

/**
 * Audits the hourly_payout_requests table to check invoice_url formats.
 */
export const auditInvoiceUrls = async () => {
    console.log('--- STARTING INVOICE URL AUDIT ---');
    
    try {
        const { data, error } = await supabase
            .from('hourly_payout_requests')
            .select('id, invoice_url, status, member_id')
            .not('invoice_url', 'is', null);

        if (error) throw error;

        console.log(`Found ${data.length} records with an invoice_url.`);

        let malformedCount = 0;
        let correctCount = 0;

        data.forEach(record => {
            const url = record.invoice_url;
            console.log(`\nRecord ID: ${record.id} | Status: ${record.status}`);
            console.log(`Original URL: ${url}`);

            let isValid = false;
            let issues = [];

            // Simple checks
            if (url.includes('http')) {
                issues.push('Contains full HTTP URL (recommended to store relative path)');
            }
            
            if (!url.includes('/')) {
                issues.push('No folder structure detected (expected e.g. year/month/filename)');
            }

            if (url.startsWith('invoices/')) {
                isValid = true;
            } else if (url.split('/').length >= 2) {
                isValid = true; // Has some folder structure
            } else {
                issues.push('Does not start with "invoices/" or lack folder structure.');
            }

            if (isValid && issues.length === 0) {
                console.log(`✅ Status: OK`);
                correctCount++;
            } else {
                console.warn(`⚠️ Status: WARNING`);
                issues.forEach(i => console.warn(`   - ${i}`));
                malformedCount++;
            }
        });

        console.log('\n--- AUDIT SUMMARY ---');
        console.log(`Total URLs checked: ${data.length}`);
        console.log(`Seem correct: ${correctCount}`);
        console.log(`Have warnings: ${malformedCount}`);
        console.log('--- END AUDIT ---');

        return { success: true, total: data.length, warnings: malformedCount };

    } catch (err) {
        console.error('Audit failed:', err);
        return { success: false, error: err.message };
    }
};