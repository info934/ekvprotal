import { supabase } from './customSupabaseClient';
import { fetchWorkOverview } from './workOverviewData';
import { loadUnifiedTasks, filterWorkTasks } from './unifiedTasks';
import { localDateKey, isClosedTask } from '../domain/workOverview';
export async function loadWorkOverview(options) {
 const [overview,result]=await Promise.all([fetchWorkOverview(supabase,options),loadUnifiedTasks(supabase,options).then(rows=>({rows})).catch(()=>({error:true}))]);
 if(result.error)return {...overview,tasks:[],openCount:null,overdueCount:null,error:[overview.error,'Společnou frontu úkolů se nepodařilo načíst.'].filter(Boolean).join(' ')};
 const own=result.rows.filter(t=>options.memberId&&t.assignedIds.includes(options.memberId)&&!isClosedTask(t));
 overview.tasks=own.slice(0,6);overview.openCount=own.length;overview.overdueCount=filterWorkTasks(own,{scope:'overdue'}).length;
 overview.reminders=[];
 if(options.memberId&&options.hasPermission('attendance','can_read')) {
  const today=localDateKey();
  const [plans,actual]=await Promise.all([
   supabase.from('attendance_plans').select('id',{count:'exact',head:true}).eq('member_id',options.memberId).eq('date',today).eq('cancelled',false).in('kind',['work','home_office']).abortSignal(options.signal),
   supabase.from('attendance').select('id',{count:'exact',head:true}).eq('member_id',options.memberId).eq('date',today).abortSignal(options.signal),
  ]);
  if(plans.error||actual.error)overview.error=[overview.error,'Kontrolu dnešní docházky se nepodařilo načíst.'].filter(Boolean).join(' ');
  else if(plans.count>0&&actual.count===0)overview.reminders.push({path:'/attendance',label:'Dnes máte plánovanou práci, docházka zatím není zapsaná.'});
 }
 return overview;
}
