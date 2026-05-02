import { supabase } from '@/lib/customSupabaseClient';

/**
 * Logs payout actions to the console and audit_logs table for comprehensive debugging and tracking.
 * @param {string} action - The action being performed (e.g., 'approval_attempt', 'upload_success').
 * @param {string} requestId - The ID of the hourly payout request.
 * @param {object} details - Additional details to log (old status, new status, errors, etc.).
 */
export const logPayoutAction = async (action, requestId, details = {}) => {
  // Detailed console logging for debugging
  console.log(`[PAYOUT_ACTION] ${action} | Request ID: ${requestId}`, details);

  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      // Optional: Log to audit_logs table if it exists and permissions allow
      await supabase.from('audit_logs').insert([{
        user_id: user.id,
        user_email: user.email,
        action: `payout_${action}`,
        details: {
          request_id: requestId,
          ...details,
          timestamp: new Date().toISOString()
        }
      }]);
    }
  } catch (error) {
    console.error(`[PAYOUT_ACTION_ERROR] Failed to save audit log for ${action}:`, error);
  }
};

/**
 * Specifically logs the hourly payout approval action.
 */
export const logHourlyPayoutApproval = async (requestId, adminId, adminNote, approvedWithoutInvoice) => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const action = approvedWithoutInvoice ? 'hourly_payout_approved_without_invoice' : 'hourly_payout_approved_with_invoice';
    
    await supabase.from('audit_logs').insert([{
      user_id: adminId || user.id,
      user_email: user.email,
      action: action,
      details: {
        request_id: requestId,
        admin_note: adminNote,
        approved_without_invoice: approvedWithoutInvoice,
        timestamp: new Date().toISOString()
      }
    }]);
  } catch (error) {
    console.error('Error logging hourly payout approval:', error);
  }
};