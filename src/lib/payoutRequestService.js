import { supabase } from '@/lib/customSupabaseClient';

export const savePayoutRequest = async (payoutData, isEditMode = false, payoutId = null) => {
  if (isEditMode) {
    const { error: payoutError } = await supabase
      .from('payouts')
      .update({
        member_id: payoutData.member_id,
        request_date: payoutData.request_date,
        reason: payoutData.reason,
        amount: payoutData.items.reduce((sum, item) => sum + item.amount, 0)
      })
      .eq('id', payoutId);

    if (payoutError) throw payoutError;

    const { error: deleteError } = await supabase
      .from('payout_items')
      .delete()
      .eq('payout_id', payoutId);

    if (deleteError) throw deleteError;

    const itemsToInsert = payoutData.items.map(item => ({
      payout_id: payoutId,
      project_id: item.project_id || null,
      realization_id: item.realization_id || null,
      amount: item.amount
    }));

    const { error: itemsError } = await supabase
      .from('payout_items')
      .insert(itemsToInsert);

    if (itemsError) throw itemsError;
    return { id: payoutId };
  }

  const totalAmount = payoutData.items.reduce((sum, item) => sum + item.amount, 0);

  const { data: newPayout, error: payoutError } = await supabase
    .from('payouts')
    .insert({
      member_id: payoutData.member_id,
      amount: totalAmount,
      status: 'pending',
      request_date: payoutData.request_date,
      reason: payoutData.reason
    })
    .select()
    .single();

  if (payoutError) throw payoutError;

  const itemsToInsert = payoutData.items.map(item => ({
    payout_id: newPayout.id,
    project_id: item.project_id || null,
    realization_id: item.realization_id || null,
    amount: item.amount
  }));

  const { error: itemsError } = await supabase
    .from('payout_items')
    .insert(itemsToInsert);

  if (itemsError) throw itemsError;
  return newPayout;
};
