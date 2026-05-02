import { supabase } from '@/lib/customSupabaseClient';

// --- CHECK FUNCTIONS ---

export const checkOrphanedRecords = async () => {
  const issues = [];
  
  // Check orphaned attendance (invalid member_id)
  const { data: att } = await supabase.from('attendance')
    .select('id, member_id')
    .not('member_id', 'in', (await supabase.from('members').select('id')).data.map(m => m.id));
  
  if (att && att.length > 0) issues.push({ type: 'ORPHANED_ATTENDANCE', count: att.length, details: 'Attendance records pointing to non-existent members' });

  return issues;
};

export const checkInvalidBudgets = async () => {
  const issues = [];
  const { data } = await supabase.from('projects')
    .select('id, name, budget_percentage, overhead_percentage')
    .or('budget_percentage.lt.0,budget_percentage.gt.100,overhead_percentage.lt.0,overhead_percentage.gt.100');
    
  if (data && data.length > 0) {
    issues.push({ 
      type: 'INVALID_PROJECT_PCT', 
      count: data.length, 
      details: 'Projects with percentages outside 0-100 range',
      ids: data.map(p => p.id)
    });
  }
  return issues;
};

export const checkInvalidPayouts = async () => {
  const issues = [];
  const { data } = await supabase.from('payouts')
    .select('id, amount')
    .lte('amount', 0);
    
  if (data && data.length > 0) {
    issues.push({
      type: 'INVALID_PAYOUT_AMOUNT',
      count: data.length,
      details: 'Payouts with zero or negative amount',
      ids: data.map(p => p.id)
    });
  }
  return issues;
};

export const checkInconsistentRealizationCosts = async () => {
    const issues = [];
    // Identify realizations where actual costs exceed contract amount (potential risk, not strictly "invalid" but "warning")
    const { data } = await supabase.from('realizations')
        .select('id, name, contract_amount, actual_costs');
        
    if (data) {
        const risky = data.filter(r => (r.actual_costs || 0) > (r.contract_amount || 0));
        if (risky.length > 0) {
             issues.push({
                type: 'REALIZATION_LOSS_RISK',
                count: risky.length,
                details: 'Realizations where actual costs exceed contract amount',
                ids: risky.map(r => r.id)
             });
        }
    }
    return issues;
};

export const runAllChecks = async () => {
  const results = [
    ...(await checkOrphanedRecords()),
    ...(await checkInvalidBudgets()),
    ...(await checkInvalidPayouts()),
    ...(await checkInconsistentRealizationCosts())
  ];
  return results;
};