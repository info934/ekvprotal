import { supabase } from '@/lib/customSupabaseClient';
import { sendHourlyApprovalEmail, sendHourlyRejectionEmail } from './hourlyPayoutEmailService';

/**
 * Updates the status of an hourly payout request and triggers corresponding emails.
 * 
 * @param {string} id - The ID of the request.
 * @param {'approved' | 'rejected' | 'paid'} status - The new status.
 * @param {string|null} rejectionReason - Optional reason if rejected.
 * @param {object} requestData - The full request object to extract email and project details.
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export const updateHourlyPayoutRequestStatus = async (id, status, rejectionReason = null, requestData = null) => {
  try {
    const updatePayload = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'approved') {
      updatePayload.approved_at = new Date().toISOString();
    } else if (status === 'rejected') {
      updatePayload.rejected_at = new Date().toISOString();
      updatePayload.rejection_reason = rejectionReason;
    }

    const { error } = await supabase
      .from('hourly_payout_requests')
      .update(updatePayload)
      .eq('id', id);

    if (error) throw error;

    // Handle Emails
    if (requestData && requestData.members?.email) {
      if (status === 'approved') {
        await sendHourlyApprovalEmail(requestData, requestData.members.email);
      } else if (status === 'rejected') {
        await sendHourlyRejectionEmail(requestData, requestData.members.email, rejectionReason);
      }
    }

    return { success: true, error: null };
  } catch (error) {
    console.error('Error updating hourly payout status:', error);
    return { success: false, error: error.message };
  }
};