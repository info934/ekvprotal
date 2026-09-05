import { fetchReportRows } from './reportData.js';
import { isClosedTask, localDateKey } from '../domain/workOverview.js';
export function taskQueueFilters(params) {
 return {
  scope: ['open','mine','overdue','blocked','all'].includes(params.get('scope')) ? params.get('scope') : 'open',
  kind: ['project','realization'].includes(params.get('kind')) ? params.get('kind') : 'all',
  search: (params.get('q') || '').slice(0,250),
 };
}
export function taskExactDate(value) {
 const day = String(value || '').slice(0,10);
 if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
 const date = new Date(day + 'T12:00:00');
 if (!Number.isFinite(date.getTime()) || localDateKey(date) !== day) return '';
 return new Intl.DateTimeFormat('cs-CZ',{day:'numeric',month:'numeric',year:'numeric'}).format(date);
}
const searchText = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('cs');
export const TASK_LABELS = { planned:'Nové', ready:'Připraveno', in_progress:'V řešení', blocked:'Blokováno', done:'Hotovo', cancelled:'Zrušeno' };
export function mergeWorkTasks(plans, items, legacy, assignments = []) {
  const linked = new Set(items.map(i=>i.legacy_project_task_id).filter(Boolean));
  const byPlan = new Map(plans.map(p=>[p.plan_id,p]));
  return [
    ...items.filter(i=>byPlan.has(i.plan_id)).map(i=>{
      const p=byPlan.get(i.plan_id);
      return {...i,id:`plan:${i.id}`,sourceId:i.id,status:TASK_LABELS[i.status]||i.status,kind:p.entity_type,
        project:{name:p.title||p.entity_name||p.name,code:p.code||p.entity_code},
        assignedIds:[i.member_id,...assignments.filter(a=>a.item_id===i.id).map(a=>a.member_id)].filter(Boolean),
        path:`/${p.entity_type==='project'?'projects':'realizace'}/${p.entity_id}?planItem=${encodeURIComponent(i.id)}#plan`};
    }),
    ...legacy.filter(i=>!linked.has(i.id)).map(i=>({...i,id:`project:${i.id}`,sourceId:i.id,kind:'project',assignedIds:[i.member_id].filter(Boolean),path:`/projects/${i.project_id}?task=${i.id}#tasks`})),
  ].sort((a,b)=>(a.end_date||'9999').localeCompare(b.end_date||'9999')||a.id.localeCompare(b.id));
}
export function filterWorkTasks(rows,{scope='open',memberId,search='',kind='all',today=localDateKey()}={}) {
  return rows.filter(t=>(kind==='all'||kind===t.kind) &&
    (scope==='all'||!isClosedTask(t)) && (scope!=='mine'||Boolean(memberId&&t.assignedIds.includes(memberId))) &&
    (scope!=='overdue'||Boolean(t.end_date&&t.end_date.slice(0,10)<today)) &&
    (scope!=='blocked'||t.status==='Blokováno') &&
    searchText(`${t.name} ${t.project?.name||''} ${t.project?.code||''}`).includes(searchText(search.trim())));
}
export async function loadUnifiedTasks(client,{hasPermission,signal}={}) {
  if(!hasPermission('tasks','can_read')) return [];
  let query=client.rpc('list_planning_plans_safe');
  if(signal)query=query.abortSignal(signal);
  const {data,error}=await query;if(error)throw error;
  const plans=(data||[]).filter(p=>['project','realization'].includes(p.entity_type)&&hasPermission(p.entity_type==='project'?'projects':'realizace','can_read'));
  // Bounded IN lists; all pages are read and errors never become misleading zero counts.
  const items=[],assignments=[];
  for(let n=0;n<plans.length;n+=50) items.push(...await fetchReportRows(()=>client.from('planning_items').select('id,plan_id,legacy_project_task_id,name,status,end_date,member_id').in('plan_id',plans.slice(n,n+50).map(p=>p.plan_id)).eq('item_type','task').order('id'),signal));
  for(let n=0;n<items.length;n+=100) assignments.push(...await fetchReportRows(()=>client.from('planning_assignments').select('id,item_id,member_id').in('item_id',items.slice(n,n+100).map(i=>i.id)).order('id'),signal));
  const legacy=hasPermission('projects','can_read')?await fetchReportRows(()=>client.from('project_tasks').select('id,name,status,project_id,end_date,member_id,project:projects(name,code)').order('id'),signal):[];
  return mergeWorkTasks(plans,items,legacy,assignments);
}
