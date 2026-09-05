import {employeeFinanceView} from './employeeWorkspaceData.js';
import {fetchReportRows} from './reportData.js';
const pendingStatuses = new Set(['pending', 'approved', 'invoice_uploaded']);
export function pendingMemberPayouts(fixed, hourly) {
 const totals = {};
 for (const row of [...fixed, ...hourly.map(row => ({...row, amount:row.total_amount}))]) {
  if (!pendingStatuses.has(row.status) || !row.member_id) continue;
  const amount = Number(row.amount);
  if (row.amount == null || row.amount === '' || !Number.isFinite(amount) || amount < 0) throw new Error('Neplatná částka čekající výplaty.');
  totals[row.member_id] = (totals[row.member_id] || 0) + amount;
 }
 return totals;
}
const fields='id,name,email,phone,role_id,auth_user_id,attendance_enabled,user_role,internal_note,languages,company,job_title,department,bio,avatar_url,language,notification_preferences,member_roles(name),member_certifications(expiry_date)';
export async function loadMemberDirectory(client,{isAdmin,isSuperUser,memberId,signal}){
 const members=await fetchReportRows(()=>client.from('members').select(fields).order('name').order('id'),signal);
 if(!isAdmin)return {members,rewards:{},payouts:{},financeReady:false,financeError:''};
 const withSignal=q=>signal?q.abortSignal(signal):q;
 try{
  const [compensation,assignments,payoutRows,hourlyRows]=await Promise.all([
   withSignal(client.rpc('list_member_compensations_admin')),
   withSignal(client.rpc('get_member_project_rewards',{p_member_id:isSuperUser?null:memberId})),
   fetchReportRows(()=>{let q=client.from('payouts').select('id,member_id,amount,status').in('status',['approved','invoice_uploaded','pending']).order('id');return !isSuperUser&&memberId?q.eq('member_id',memberId):q;},signal),
   fetchReportRows(()=>{let q=client.from('hourly_payout_requests').select('id,member_id,total_amount,status').in('status',['approved','invoice_uploaded','pending']).order('id');return !isSuperUser&&memberId?q.eq('member_id',memberId):q;},signal),
  ]);
  if(compensation.error)throw compensation.error;if(assignments.error)throw assignments.error;
  if(!Array.isArray(compensation.data)||!Array.isArray(assignments.data))throw new Error('Neúplné finanční údaje.');
  const rates=new Map(compensation.data.map(r=>[String(r.member_id),r.hourly_rate]));
  const rewards={},payouts=pendingMemberPayouts(payoutRows,hourlyRows);
  for(const r of assignments.data){const amount=Number(r.total_reward||0);if(!Number.isFinite(amount))throw new Error('Neplatná částka odměny.');rewards[r.member_id]=(rewards[r.member_id]||0)+Math.max(0,amount);}
  const remaining = {};
  // Bound concurrency; use the same authorized entitlement RPC as the detail.
  for (let start=0;start<members.length;start+=4) {
   await Promise.all(members.slice(start,start+4).map(async member => {
    if(signal?.aborted)throw new DOMException('Načítání přerušeno.','AbortError');
    try {
     const result=await withSignal(client.rpc('get_payout_availability',{p_member_id:member.id,p_edit_payout_id:null}));
     if(result.error || !Array.isArray(result.data?.projects) || !Array.isArray(result.data?.realizations)) throw new Error('Nárok není dostupný.');
     remaining[member.id]=employeeFinanceView({availability:{data:result.data}}).remaining;
    } catch(error) {if(signal?.aborted)throw error;remaining[member.id]=null;}
   }));
  }
  const balanceError=Object.values(remaining).some(value=>value===null);
  return {remaining,members:members.map(m=>({...m,hourly_rate:rates.get(String(m.id))??null})),rewards,payouts,financeReady:true,financeError:balanceError?'Některé zbývající nároky se nepodařilo načíst. Obnovte přehled.':''};
 }catch(error){if(signal?.aborted)throw error;return {members,rewards:{},payouts:{},financeReady:false,financeError:'Finanční údaje se nepodařilo načíst. Seznam zaměstnanců je dostupný; finance obnovte opakováním načtení.'};}
}
