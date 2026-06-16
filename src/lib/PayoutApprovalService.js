import { supabase } from '@/lib/customSupabaseClient';
import { logHourlyPayoutApproval } from './payoutLogger';

/**
 * Approves a payout, setting the required flags and logging the action.
 */
export const approvePayout = async (payoutId, adminNote, approvedWithoutInvoice) => {
  try {
    const { data, error } = await supabase.rpc('approve_payout', {
      p_payout_id: payoutId,
      p_admin_note: adminNote,
      p_approved_without_invoice: approvedWithoutInvoice,
    });

    if (error) throw error;
    
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
