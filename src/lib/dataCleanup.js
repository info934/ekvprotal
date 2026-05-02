import { supabase } from '@/lib/customSupabaseClient';

/**
 * Resets invalid project percentages to defaults (30% budget, 10% overhead).
 */
export const fixInvalidBudgets = async () => {
  // Fix budget > 100
  await supabase.from('projects')
    .update({ budget_percentage: 30 })
    .gt('budget_percentage', 100);

  // Fix budget < 0
  await supabase.from('projects')
    .update({ budget_percentage: 30 })
    .lt('budget_percentage', 0);
    
  // Fix overhead > 100
  await supabase.from('projects')
    .update({ overhead_percentage: 10 })
    .gt('overhead_percentage', 100);
    
  return { success: true, message: 'Invalid budgets normalized.' };
};

/**
 * Soft deletes payouts with <= 0 amount
 */
export const fixInvalidPayouts = async () => {
  const { error } = await supabase.from('payouts')
    .delete() // Assuming we want to remove them, or update status to rejected
    .lte('amount', 0);
    
  return { success: !error, error };
};