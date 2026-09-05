import { CLOSED_TASK_STATUSES, localDateKey, sumKnownCounts } from '../domain/workOverview.js';

export async function fetchWorkOverview(supabase, { hasPermission, memberId, isAdmin, userRole, signal }) {
  const errors = [];
  const canReadTasks = hasPermission('tasks', 'can_read') && Boolean(memberId || isAdmin);
  const taskQuery = (fields, options) => {
    let query = supabase.from('project_tasks').select(fields, options).not('status', 'in', `(${CLOSED_TASK_STATUSES.map(status => `"${status}"`).join(',')})`);
    if (!isAdmin) query = query.eq('member_id', memberId);
    return query;
  };
  const read = async (query, label, count = false) => {
    if (!query) return count ? 0 : [];
    const result = await query.abortSignal(signal);
    if (result.error) { errors.push(label); return count ? null : []; }
    return count ? result.count : result.data || [];
  };
  const canApproveAttendance = hasPermission('attendance', 'can_read') && (isAdmin || userRole === 'super_manager') && hasPermission('attendance', 'can_admin');
  const canApprovePayouts = hasPermission('payouts', 'can_read') && hasPermission('payouts', 'can_admin');
  const canApproveEmployeeRequests = userRole === 'admin';
  const [tasks, openCount, overdueCount, projects, realizations, attendance, payouts, hourly, employeeRequests] = await Promise.all([
    read(canReadTasks && taskQuery('id,name,status,project_id,end_date,project:projects(name,code)').order('end_date', { ascending: true, nullsFirst: false }).limit(6), 'Úkoly'),
    read(canReadTasks && taskQuery('id', { count: 'exact', head: true }), 'Počet úkolů', true),
    read(canReadTasks && taskQuery('id', { count: 'exact', head: true }).lt('end_date', localDateKey()), 'Úkoly po termínu', true),
    read(hasPermission('projects', 'can_read') && supabase.from('projects').select('id,name,code,status,completion_date').not('status', 'in', '(delivered,closed,completed,cancelled,archived)').order('completion_date', { ascending: true, nullsFirst: false }).limit(4), 'Projekce'),
    read(hasPermission('realizace', 'can_read') && supabase.from('realizations').select('id,name,code,status,planned_end_date').not('status', 'in', '("Dokončeno","Předáno","Zrušeno",completed,cancelled,archived)').order('planned_end_date', { ascending: true, nullsFirst: false }).limit(3), 'Realizace'),
    read(canApproveAttendance && supabase.from('attendance_submissions').select('id', { count: 'exact', head: true }).eq('status', 'submitted'), 'Docházka ke schválení', true),
    read(canApprovePayouts && supabase.from('payouts').select('id', { count: 'exact', head: true }).eq('status', 'pending'), 'Výplaty ke schválení', true),
    read(canApprovePayouts && supabase.from('hourly_payout_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'), 'Hodinové výplaty', true),
    read(canApproveEmployeeRequests && supabase.from('employee_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'), 'Zaměstnanecké žádosti', true),
  ]);
  const approvals = [
    canApproveAttendance && { label: 'Docházka ke schválení', count: attendance, path: '/attendance?tab=approvals', icon: 'attendance' },
    canApprovePayouts && { label: 'Žádosti o výplatu', count: payouts, path: '/payouts?status=pending', icon: 'payout' },
    canApprovePayouts && { label: 'Hodinové výplaty', count: hourly, path: '/payouts/hourly-admin', icon: 'payout' },
    canApproveEmployeeRequests && { label: 'Zaměstnanecké žádosti', count: employeeRequests, path: '/employee?tab=requests&scope=all', icon: 'employee' },
  ].filter(Boolean);
  return {
    tasks, openCount, overdueCount, approvalCount: sumKnownCounts(approvals.map(item => item.count)), approvals,
    jobs: [...projects.map(item => ({ ...item, kind: 'Projekce', path: `/projects/${item.id}`, date: item.completion_date })), ...realizations.map(item => ({ ...item, kind: 'Realizace', path: `/realizace/${item.id}`, date: item.planned_end_date }))],
    error: errors.length ? `Nepodařilo se načíst: ${[...new Set(errors)].join(', ')}. Údaje v těchto částech nejsou úplné.` : '',
  };
}
