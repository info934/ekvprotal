import { mergeWorkTasks } from '../lib/unifiedTasks.js';
import { isClosedTask } from '../domain/workOverview.js';
import { isOpenDashboardStatus as open, isOpenDashboardOpportunity as openOpportunity, isCancelledDashboardRecord as cancelled } from '../lib/crmDashboardMetrics.js';

export function overviewPreview(name, args, { tables, member, user, isAdmin, hydrate }) {
  const rows = key => (tables[key] || []).map(row => hydrate(row, key));
  const due = (a, b) => String(a.end_date || '9999').localeCompare(String(b.end_date || '9999')) || a.id.localeCompare(b.id);
  const today = args.p_today;
  const projects = rows('projects').filter(row => !cancelled(row));
  const realizations = rows('realizations').filter(row => !cancelled(row));
  const payouts = isAdmin ? rows('payouts').filter(row => row.status === 'pending') : [];
  const attendance = isAdmin ? rows('attendance_submissions').filter(row => row.status === 'submitted') : [];
  if (name === 'get_my_work_overview_v2') {
    const tasks = mergeWorkTasks(rows('planning_plans'), rows('planning_items'), rows('project_tasks'), rows('planning_assignments'))
      .filter(row => row.assignedIds.includes(member.id) && !isClosedTask(row)).sort(due);
    const approvals = isAdmin ? [
      { label: 'Docházka ke schválení', count: attendance.length, path: '/attendance?tab=approvals', icon: 'attendance' },
      { label: 'Žádosti o výplatu', count: payouts.length, path: '/payouts?status=pending', icon: 'payout' },
      { label: 'Hodinové výplaty', count: rows('hourly_payout_requests').filter(row => row.status === 'pending').length, path: '/payouts/hourly-admin', icon: 'payout' },
      { label: 'Zaměstnanecké žádosti', count: rows('employee_requests').filter(row => row.status === 'pending').length, path: '/members?view=requests', icon: 'employee' },
    ] : [];
    return { tasks: tasks.slice(0, 6), openCount: tasks.length, overdueCount: tasks.filter(row => row.end_date && row.end_date < today).length,
      jobs: [...projects.filter(row => !['delivered','closed','completed'].includes(row.status)).slice(0,4).map(row => ({...row,kind:'Projekce',path:`/projects/${row.id}`,date:row.completion_date})),
        ...realizations.filter(row => !['Dokončeno','Předáno','completed'].includes(row.status)).slice(0,3).map(row => ({...row,kind:'Realizace',path:`/realizace/${row.id}`,date:row.planned_end_date}))],
      approvals, approvalCount: approvals.reduce((sum,row) => sum + row.count, 0),
      notificationCount: rows('notifications').filter(row => row.user_id === user.id && !row.is_read).length, reminders: [], error: '' };
  }
  if (name === 'get_company_dashboard_finance_v2') return isAdmin
    ? { realizedProfit: 165000, potentialProfit: 475000, totalProjectValue: 1420000, unallocatedBudget: 125000, overheadAllocated: 98000, overheadAccounted: 84000 }
    : { data: null, error: { message: 'Admin role required', code: '42501' } };
  const financial = isAdmin && !args.p_private;
  const opportunities = isAdmin ? rows('crm_opportunities').filter(row => !cancelled(row)).map(row => ({...row,value:financial ? row.value : null, probability:financial ? row.probability : null})) : [];
  const commercial = isAdmin ? rows('crm_commercial_documents').filter(row => !cancelled(row)) : [];
  const tasks = rows('project_tasks').filter(row => !cancelled(row));
  const engineering = isAdmin ? rows('engineering_activities').filter(row => !cancelled(row)) : [];
  const activeProjects = projects.filter(row => open(row.status));
  const activeRealizations = realizations.filter(row => open(row.status));
  const activeTasks = tasks.filter(row => open(row.status));
  const overdueTasks = activeTasks.filter(row => row.end_date && row.end_date < today).sort(due);
  const activeEngineering = engineering.filter(row => open(row.status)).sort(due);
  const overdueEngineering = activeEngineering.filter(row => row.end_date && row.end_date < today);
  const openOpportunities = opportunities.filter(openOpportunity);
  const sum = (items, key) => financial ? items.reduce((total,row) => total + Number(row[key] || 0),0) : 0;
  const statuses = (items, kind) => Object.entries(items.reduce((acc,row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {})).map(([status,count]) => ({kind,status,count}));
  const stages = Object.values(openOpportunities.reduce((acc,row) => { const stage = row.stage || 'lead'; acc[stage] ||= {stage,count:0,value:0}; acc[stage].count++; acc[stage].value+=Number(row.value||0); return acc; },{}));
  return {
    summary: { projectCount: projects.length, activeProjectCount: activeProjects.length, activeRealizationCount: activeRealizations.length,
      openTaskCount: activeTasks.length, overdueTaskCount: overdueTasks.length, activeEngineeringCount: activeEngineering.length, overdueEngineeringCount: overdueEngineering.length,
      openOpportunityCount: openOpportunities.length, pipelineValue: sum(openOpportunities,'value'), weightedPipeline: financial ? openOpportunities.reduce((total,row) => total+Number(row.value||0)*Number(row.probability||0)/100,0) : 0,
      offerCount: commercial.filter(row => row.type==='offer').length, orderCount: commercial.filter(row => row.type==='order').length,
      offersValue: sum(commercial.filter(row => row.type==='offer'),'total'), ordersValue: sum(commercial.filter(row => row.type==='order'),'total'),
      activeProjectsValue: sum(activeProjects,'price'), activeRealizationsValue: sum(activeRealizations,'contract_amount'), allRealizationsValue: sum(realizations,'contract_amount'), wonValue: sum(opportunities.filter(row => row.stage==='won'),'value'),
      pendingApprovals: payouts.length+attendance.length, attentionCount:payouts.length+attendance.length+overdueTasks.length+overdueEngineering.length+openOpportunities.filter(row => row.expected_close_date && row.expected_close_date<today).length,
      activeProductCount: isAdmin ? rows('commercial_item_catalog').filter(row => row.is_active&&!row.archived_at).length : 0, documentCount:rows('documents').length },
    payouts: payouts.slice(0,5).map(row => ({...row,amount:financial?row.amount:null})), attendanceSubmissions:attendance.slice(0,5),
    overdueTasks:overdueTasks.slice(0,3), overdueEngineering:overdueEngineering.slice(0,3), activeEngineering:activeEngineering.slice(0,6),
    topOpportunities:[...openOpportunities].sort((a,b)=>(b.value||0)-(a.value||0)).slice(0,10),
    upcomingOpportunities:openOpportunities.filter(row=>row.expected_close_date).sort((a,b)=>a.expected_close_date.localeCompare(b.expected_close_date)).slice(0,2),
    stageSummary:stages, statusCounts:[...statuses(projects,'projects'),...statuses(tasks,'tasks'),...statuses(engineering,'engineering')],
  };
}
