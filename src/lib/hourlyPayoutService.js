import { sendHourlyApprovalEmail, sendHourlyRejectionEmail } from './hourlyPayoutEmailService';
import {
  approveHourlyPayoutRequestWorkflow,
  markHourlyPayoutPaid,
  rejectHourlyPayoutRequestWorkflow,
} from './hourlyPayoutWorkflowService';

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
    if (status === 'approved') {
      await approveHourlyPayoutRequestWorkflow(id, null, false);
    } else if (status === 'rejected') {
      await rejectHourlyPayoutRequestWorkflow(id, rejectionReason);
    } else if (status === 'paid') {
      await markHourlyPayoutPaid(id);
    } else {
      throw new Error(`Unsupported hourly payout status: ${status}`);
    }

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
