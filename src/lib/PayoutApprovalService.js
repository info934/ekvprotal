import { supabase } from '@/lib/customSupabaseClient';
import { logHourlyPayoutApproval } from './payoutLogger';

/**
 * Logs the payout approval action to the audit_logs table.
 */
export const logPayoutApproval = async (payoutId, adminId, adminNote, approvedWithoutInvoice) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const action = approvedWithoutInvoice ? 'payout_approved_without_invoice' : 'payout_approved_with_invoice';
    
    await supabase.from('audit_logs').insert([{
      user_id: adminId || user.id,
      user_email: user.email,
      action: action,
      details: {
        payout_id: payoutId,
        admin_note: adminNote,
        approved_without_invoice: approvedWithoutInvoice,
        timestamp: new Date().toISOString()
      }
    }]);
  } catch (error) {
    console.error('Error logging payout approval:', error);
  }
};

/**
 * Approves a payout, setting the required flags and logging the action.
 */
export const approvePayout = async (payoutId, adminNote, approvedWithoutInvoice) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: currentPayout, error: fetchError } = await supabase
      .from('payouts')
      .select('variable_symbol')
      .eq('id', payoutId)
      .single();

    if (fetchError) throw fetchError;
    
    const updateData = {
      status: 'approved',
      approved_without_invoice: approvedWithoutInvoice,
      admin_note: adminNote,
      approved_at: new Date().toISOString()
    };

    if (!currentPayout?.variable_symbol) {
      updateData.variable_symbol = Math.floor(Math.random() * 10000000000).toString().padStart(10, '0');
    }

    const { data, error } = await supabase
      .from('payouts')
      .update(updateData)
      .eq('id', payoutId)
      .select()
      .single();

    if (error) throw error;

    await logPayoutApproval(payoutId, user?.id, adminNote, approvedWithoutInvoice);
    
    return { success: true, data };
  } catch (error) {
    console.error('Error approving payout:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fetches the audit logs for a specific payout.
 */
export const getPayoutApprovalHistory = async (payoutId) => {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .contains('details', { payout_id: payoutId })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Error fetching payout approval history:', error);
    return { success: false, error: error.message, data: [] };
  }
};

/**
 * Approves an hourly payout request, setting the required flags and logging the action.
 */
export const approveHourlyPayoutRequest = async (requestId, adminNote, approvedWithoutInvoice) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    const updateData = {
      status: 'approved',
      approved_without_invoice: approvedWithoutInvoice,
      admin_note: adminNote,
      approved_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('hourly_payout_requests')
      .update(updateData)
      .eq('id', requestId)
      .select()
      .single();

    if (error) throw error;

    await logHourlyPayoutApproval(requestId, user?.id, adminNote, approvedWithoutInvoice);
    
    return { success: true, data };
  } catch (error) {
    console.error('Error approving hourly payout request:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fetches the audit logs for a specific hourly payout request.
 */
export const getHourlyPayoutApprovalHistory = async (requestId) => {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .contains('details', { request_id: requestId })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    console.error('Error fetching hourly payout approval history:', error);
    return { success: false, error: error.message, data: [] };
  }
};
