import {fetchReportRows} from './reportData.js';
const fields='id,name,email,phone,role_id,auth_user_id,attendance_enabled,user_role,internal_note,languages,company,job_title,department,bio,avatar_url,language,notification_preferences,member_roles(name),member_certifications(expiry_date)';
export async function loadMemberDirectory(client,{isAdmin,isSuperUser,memberId,signal}){
 const members=await fetchReportRows(()=>client.from('members').select(fields).order('name').order('id'),signal);
 if(!isAdmin)return {members,rewards:{},payouts:{},financeReady:false,financeError:''};
 const withSignal=q=>signal?q.abortSignal(signal):q;
 try{
  const [compensation,assignments,payoutRows]=await Promise.all([
   withSignal(client.rpc('list_member_compensations_admin')),
   withSignal(client.rpc('get_member_project_rewards',{p_member_id:isSuperUser?null:memberId})),
   fetchReportRows(()=>{let q=client.from('payouts').select('id,member_id,amount').in('status',['paid','approved','invoice_uploaded','pending']).order('id');return !isSuperUser&&memberId?q.eq('member_id',memberId):q;},signal),
  ]);
  if(compensation.error)throw compensation.error;if(assignments.error)throw assignments.error;
  if(!Array.isArray(compensation.data)||!Array.isArray(assignments.data))throw new Error('Neúplné finanční údaje.');
  const rates=new Map(compensation.data.map(r=>[String(r.member_id),r.hourly_rate]));
  const rewards={},payouts={};
  for(const r of assignments.data){const amount=Number(r.total_reward||0);if(!Number.isFinite(amount))throw new Error('Neplatná částka odměny.');rewards[r.member_id]=(rewards[r.member_id]||0)+Math.max(0,amount);}
  for(const r of payoutRows){const amount=Number(r.amount||0);if(!Number.isFinite(amount))throw new Error('Neplatná částka výplaty.');if(r.member_id)payouts[r.member_id]=(payouts[r.member_id]||0)+amount;}
  return {members:members.map(m=>({...m,hourly_rate:rates.get(String(m.id))??null})),rewards,payouts,financeReady:true,financeError:''};
 }catch(error){if(signal?.aborted)throw error;return {members,rewards:{},payouts:{},financeReady:false,financeError:'Finanční údaje se nepodařilo načíst. Seznam zaměstnanců je dostupný; finance obnovte opakováním načtení.'};}
}
