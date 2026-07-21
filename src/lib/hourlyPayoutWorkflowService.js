import { supabase } from '@/lib/customSupabaseClient';

export const createHourlyPayoutRequest = async ({
  memberId,
  payoutMonth,
  payoutYear,
  requestType = 'regular',
  parentRequestId = null,
}) => {
  const { data, error } = await supabase.rpc('create_hourly_payout_request', {
    p_member_id: memberId,
    p_payout_month: payoutMonth,
    p_payout_year: payoutYear,
    p_request_type: requestType,
    p_parent_request_id: parentRequestId,
  });

  if (error) throw error;
  return data;
};

export const approveHourlyPayoutRequestWorkflow = async (requestId, adminNote, approvedWithoutInvoice) => {
  const { data, error } = await supabase.rpc('approve_hourly_payout_request', {
    p_request_id: requestId,
    p_admin_note: adminNote || null,
    p_approved_without_invoice: !!approvedWithoutInvoice,
  });

  if (error) throw error;
  return data;
};

export const rejectHourlyPayoutRequestWorkflow = async (requestId, reason) => {
  const { data, error } = await supabase.rpc('reject_hourly_payout_request', {
    p_request_id: requestId,
    p_rejection_reason: reason || null,
  });

  if (error) throw error;
  return data;
};

export const uploadHourlyPayoutInvoice = async (requestId, storedInvoice) => {
  const { data, error } = await supabase.rpc('upload_hourly_payout_invoice_v2', {
    p_request_id: requestId,
    p_invoice_url: storedInvoice.dbUrl,
    p_storage_provider: storedInvoice.provider || 'supabase',
    p_storage_connection_id: storedInvoice.connectionId || null,
    p_external_file_id: storedInvoice.fileId || storedInvoice.filePath || null,
    p_storage_metadata: storedInvoice.metadata || {},
  });

  if (error) throw error;
  return data;
};

export const clearHourlyPayoutInvoice = async (requestId) => {
  const { data, error } = await supabase.rpc('clear_hourly_payout_invoice', {
    p_request_id: requestId,
  });
  if (error) throw error;
  return data;
};

export const markHourlyPayoutPaid = async (requestId) => {
  const { data, error } = await supabase.rpc('mark_hourly_payout_paid', {
    p_request_id: requestId,
  });

  if (error) throw error;
  return data;
};

export const getHourlyPayoutDiscrepancies = async () => {
  const { data, error } = await supabase.rpc('get_hourly_payout_discrepancies');

  if (error) throw error;
  return data || [];
};
