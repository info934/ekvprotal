const copyName = (value, fallback) => {
  const name = String(value || fallback).trim();
  return `${name} – kopie`.slice(0, 200);
};

export const projectDuplicateDefaults = (source, memberId) => ({
  name: copyName(source?.name, 'Nový projekt'),
  code: '',
  status: 'nabidka',
  price: 0,
  budget_percentage: 30,
  overhead_percentage: 10,
  type: source?.type || '',
  stage_id: source?.stage_id || null,
  created_by_member_id: memberId || null,
  completion_date: '',
  start_date: '',
  complexity_level: source?.complexity_level || 'standard',
  estimated_work_days: Number(source?.estimated_work_days) > 0 ? Number(source.estimated_work_days) : 10,
  location: source?.location || '',
  client_internal_ref: '',
  brief: source?.brief || '',
  investor_id: source?.investor_id || null,
  client_id: source?.client_id || null,
  is_priority: Boolean(source?.is_priority),
});

export const realizationDuplicateDefaults = source => ({
  name: copyName(source?.name, 'Nová realizace'),
  status: 'Připravuje se',
  type: source?.type || '',
  investor_id: source?.investor_id || null,
  lead_person_id: source?.lead_person_id || null,
  contract_amount: 0,
  actual_costs: 0,
  profit_margin_percent: 0,
  overhead_percent: 0,
  start_date: '',
  planned_end_date: '',
  complexity_level: source?.complexity_level || 'standard',
  estimated_work_days: Number(source?.estimated_work_days) > 0 ? Number(source.estimated_work_days) : 10,
  actual_end_date: '',
  location_address: source?.location_address || '',
});

