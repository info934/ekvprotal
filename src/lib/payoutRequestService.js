import { supabase } from '@/lib/customSupabaseClient';

export const savePayoutRequest = async (payoutData, isEditMode = false, payoutId = null) => {
  const items = payoutData.items.map((item) => ({
    project_id: item.project_id || null,
    realization_id: item.realization_id || null,
    amount: item.amount,
  }));

  if (isEditMode) {
    const { data, error } = await supabase.rpc('update_payout_request', {
      p_payout_id: payoutId,
      p_member_id: payoutData.member_id,
      p_request_date: payoutData.request_date,
      p_reason: payoutData.reason,
      p_items: items,
    });

    if (error) throw error;
    return data || { id: payoutId };
  }

  const { data, error } = await supabase.rpc('create_payout_request', {
    p_member_id: payoutData.member_id,
    p_request_date: payoutData.request_date,
    p_reason: payoutData.reason,
    p_items: items,
  });

  if (error) throw error;
  return data;
};
