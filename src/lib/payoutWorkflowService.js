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
 * Logs workflow action for audit trail
 */
const logWorkflowAction = async (action, payoutId, details = {}) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    await supabase.from('audit_logs').insert({
      user_id: user?.id,
      user_email: user?.email,
      action: `payout_workflow_${action}`,
      details: {
        payout_id: payoutId,
        ...details
      }
    });
  } catch (error) {
    console.error('[PayoutWorkflow] Audit log error:', error);
  }
};

/**
 * Validates status transition is allowed
 */
const canTransition = (currentStatus, targetStatus) => {
  const validTransitions = {
    'pending': ['approved', 'rejected'],
    'approved': ['paid', 'invoice_uploaded'],
    'invoice_uploaded': ['paid'],
    'paid': [],
    'rejected': []
  };
  
  return validTransitions[currentStatus]?.includes(targetStatus);
};

/**
 * TASK 3.1: Approve payout request
 * Changes status from pending → approved
 * Sets approved_by and approved_at timestamps
 */
export const approvePayout = async (payoutId, adminId, adminNote = null, approvedWithoutInvoice = false) => {
  try {
    console.log('[PayoutWorkflow] Approving payout:', { payoutId, adminId, approvedWithoutInvoice });
    
    // Get current payout status
    const { data: payout, error: fetchError } = await supabase
      .from('payouts')
      .select('status, member_id, amount')
      .eq('id', payoutId)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Validate status transition
    if (payout.status !== 'pending') {
      return {
        success: false,
        error: `Cannot approve payout with status '${payout.status}'. Must be 'pending'.`
      };
    }
    
    const now = new Date().toISOString();
    
    // Update payout
    const { error: updateError } = await supabase
      .from('payouts')
      .update({
        status: 'approved',
        approved_by: adminId,
        approved_at: now,
        admin_note: adminNote,
        approved_without_invoice: approvedWithoutInvoice
      })
      .eq('id', payoutId);
    
    if (updateError) throw updateError;
    
    await logWorkflowAction('approve', payoutId, {
      admin_id: adminId,
      approved_without_invoice: approvedWithoutInvoice,
      admin_note: adminNote
    });
    
    console.log('[PayoutWorkflow] Payout approved successfully');
    return { success: true };
    
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
export const uploadInvoice = async (payoutId, invoiceUrl, invoiceName) => {
  try {
    console.log('[PayoutWorkflow] Uploading invoice:', { payoutId, invoiceUrl, invoiceName });
    
    // Get current payout status
    const { data: payout, error: fetchError } = await supabase
      .from('payouts')
      .select('status, member_id')
      .eq('id', payoutId)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Validate status
    if (payout.status !== 'approved') {
      return {
        success: false,
        error: `Cannot upload invoice for payout with status '${payout.status}'. Must be 'approved'.`
      };
    }
    
    const now = new Date().toISOString();
    
    // Update payout with invoice details
    const { error: updateError } = await supabase
      .from('payouts')
      .update({
        invoice_url: invoiceUrl,
        invoice_name: invoiceName,
        invoice_uploaded_at: now,
        status: 'invoice_uploaded'
      })
      .eq('id', payoutId);
    
    if (updateError) throw updateError;
    
    await logWorkflowAction('invoice_upload', payoutId, {
      invoice_name: invoiceName
    });
    
    console.log('[PayoutWorkflow] Invoice uploaded successfully');
    return { success: true };
    
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
    
    // Get current payout status
    const { data: payout, error: fetchError } = await supabase
      .from('payouts')
      .select('status, invoice_url, member_id, amount')
      .eq('id', payoutId)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Validate status
    if (payout.status !== 'invoice_uploaded') {
      return {
        success: false,
        error: `Cannot confirm invoice for payout with status '${payout.status}'. Must be 'invoice_uploaded'.`
      };
    }
    
    // Validate invoice exists
    if (!payout.invoice_url) {
      return {
        success: false,
        error: 'Cannot confirm payment without uploaded invoice.'
      };
    }
    
    const now = new Date().toISOString();
    
    // Update payout to paid
    const { error: updateError } = await supabase
      .from('payouts')
      .update({
        status: 'paid',
        paid_at: now
      })
      .eq('id', payoutId);
    
    if (updateError) throw updateError;
    
    await logWorkflowAction('confirm_invoice', payoutId, {
      admin_id: adminId
    });
    
    console.log('[PayoutWorkflow] Invoice confirmed, payout marked as paid');
    return { success: true };
    
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
    
    // Get current payout status
    const { data: payout, error: fetchError } = await supabase
      .from('payouts')
      .select('status, approved_without_invoice, member_id, amount')
      .eq('id', payoutId)
      .single();
    
    if (fetchError) throw fetchError;
    
    // Validate status
    if (payout.status !== 'approved') {
      return {
        success: false,
        error: `Cannot mark as paid without invoice for status '${payout.status}'. Must be 'approved'.`
      };
    }
    
    // Validate approved_without_invoice flag
    if (!payout.approved_without_invoice) {
      return {
        success: false,
        error: 'Payout was not approved without invoice requirement. User must upload invoice first.'
      };
    }
    
    const now = new Date().toISOString();
    
    // Update payout to paid
    const { error: updateError } = await supabase
      .from('payouts')
      .update({
        status: 'paid',
        paid_at: now
      })
      .eq('id', payoutId);
    
    if (updateError) throw updateError;
    
    await logWorkflowAction('approve_without_invoice', payoutId, {
      admin_id: adminId
    });
    
    console.log('[PayoutWorkflow] Payout marked as paid without invoice');
    return { success: true };
    
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