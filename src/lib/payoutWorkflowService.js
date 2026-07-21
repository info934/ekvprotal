/**
 * PAYOUT WORKFLOW SERVICE
 * 
 * This service manages the complete payout workflow lifecycle:
 * 
 * NORMAL FLOW:
 * 1. pending → approved (admin approves request)
 * 2. approved → invoice_uploaded (user uploads invoice)
 * 3. invoice_uploaded → paid (admin confirms payment)
 * 
 * ALTERNATIVE FLOW (no invoice required):
 * 1. pending → approved (admin approves without invoice requirement)
 * 2. approved → paid (admin marks as paid directly)
 */

import { supabase } from '@/lib/customSupabaseClient';

/**
 * TASK 3.1: Approve payout request
 * Changes status from pending → approved
 * Sets approved_by and approved_at timestamps
 */
export const approvePayout = async (payoutId, adminId, adminNote = null, approvedWithoutInvoice = false) => {
  try {
    console.log('[PayoutWorkflow] Approving payout:', { payoutId, adminId, approvedWithoutInvoice });

    const { data, error } = await supabase.rpc('approve_payout', {
      p_payout_id: payoutId,
      p_admin_note: adminNote,
      p_approved_without_invoice: approvedWithoutInvoice
    });

    if (error) throw error;
    
    console.log('[PayoutWorkflow] Payout approved successfully');
    return { success: true, data };
    
  } catch (error) {
    console.error('[PayoutWorkflow] Approve error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * TASK 3.2: Upload invoice
 * Sets invoice_url and invoice_uploaded_at
 * Changes status to invoice_uploaded if currently approved
 */
export const uploadInvoice = async (payoutId, storedInvoice, invoiceName) => {
  try {
    const invoiceUrl = typeof storedInvoice === 'string' ? storedInvoice : storedInvoice?.dbUrl;
    console.log('[PayoutWorkflow] Uploading invoice:', { payoutId, invoiceName });

    const { data, error } = await supabase.rpc('upload_payout_invoice_v2', {
      p_payout_id: payoutId,
      p_invoice_url: invoiceUrl,
      p_invoice_name: invoiceName,
      p_storage_provider: storedInvoice?.provider || 'supabase',
      p_storage_connection_id: storedInvoice?.connectionId || null,
      p_external_file_id: storedInvoice?.fileId || null,
      p_storage_metadata: storedInvoice?.metadata || {},
    });

    if (error) throw error;
    
    console.log('[PayoutWorkflow] Invoice uploaded successfully');
    return { success: true, data };
    
  } catch (error) {
    console.error('[PayoutWorkflow] Upload invoice error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * TASK 3.3: Confirm invoice and mark as paid
 * Changes status from invoice_uploaded → paid
 * Sets paid_at timestamp
 */
export const confirmInvoice = async (payoutId, adminId) => {
  try {
    console.log('[PayoutWorkflow] Confirming invoice:', { payoutId, adminId });

    const { data, error } = await supabase.rpc('mark_payout_paid', {
      p_payout_id: payoutId
    });

    if (error) throw error;
    
    console.log('[PayoutWorkflow] Invoice confirmed, payout marked as paid');
    return { success: true, data };
    
  } catch (error) {
    console.error('[PayoutWorkflow] Confirm invoice error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * TASK 3.4: Approve without invoice (direct payment)
 * Changes status from approved → paid directly (skips invoice_uploaded)
 * Sets paid_at timestamp
 */
export const approveWithoutInvoice = async (payoutId, adminId) => {
  try {
    console.log('[PayoutWorkflow] Approving without invoice:', { payoutId, adminId });

    const { data, error } = await supabase.rpc('mark_payout_paid', {
      p_payout_id: payoutId
    });

    if (error) throw error;
    
    console.log('[PayoutWorkflow] Payout marked as paid without invoice');
    return { success: true, data };
    
  } catch (error) {
    console.error('[PayoutWorkflow] Approve without invoice error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get payout by ID with related data
 */
export const getPayoutById = async (payoutId) => {
  try {
    const { data, error } = await supabase
      .from('payouts')
      .select(`
        *,
        members:members!payouts_member_id_fkey(id, name, email),
        approver:members!payouts_approved_by_fkey(id, name, email),
        payout_items(*, projects(name, code), realizations(name))
      `)
      .eq('id', payoutId)
      .single();
    
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('[PayoutWorkflow] Get payout error:', error);
    return { success: false, error: error.message };
  }
};
