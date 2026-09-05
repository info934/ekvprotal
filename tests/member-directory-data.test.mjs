import test from 'node:test';
import assert from 'node:assert/strict';
import {loadMemberDirectory,pendingMemberPayouts} from '../src/lib/memberDirectoryData.js';
function client({fail,admin=true}={}){const calls=[];return {calls,from(table){calls.push(table);let start=0;const q={select(){return q;},order(){return q;},in(){return q;},eq(){return q;},range(n){start=n;return q;},abortSignal(){return q;},then(resolve){return Promise.resolve(table===fail?{error:{message:'offline'}}:{data:start?[]:table==='members'?[{id:'m',name:'Test'}]:[{id:'p',member_id:'m',amount:20,total_amount:30,status:'pending'}]}).then(resolve);}};return q;},rpc(name){calls.push(name);return Promise.resolve(name===fail?{error:{message:'offline'}}:{data:name==='list_member_compensations_admin'?[{member_id:'m',hourly_rate:400}]:[{member_id:'m',total_reward:100}]});}};}
test('unavailable finance retains directory without fabricated zero totals',async()=>{const result=await loadMemberDirectory(client({fail:'list_member_compensations_admin'}),{isAdmin:true});assert.equal(result.members.length,1);assert.equal(result.financeReady,false);assert.match(result.financeError,/Finanční/);assert.deepEqual(result.rewards,{});});
test('directory failure is not converted to empty success',async()=>{await assert.rejects(loadMemberDirectory(client({fail:'members'}),{isAdmin:false}));});
test('non-admin never requests compensation or payout sources',async()=>{const c=client();const result=await loadMemberDirectory(c,{isAdmin:false});assert.equal(result.members.length,1);assert(c.calls.every(name=>name==='members'));});
test('finance is marked ready only after all sources succeed',async()=>{const result=await loadMemberDirectory(client(),{isAdmin:true,isSuperUser:true});assert.equal(result.financeReady,true);assert.equal(result.members[0].hourly_rate,400);assert.equal(result.rewards.m,100);assert.equal(result.payouts.m,50);});

test('pending totals include both payout types but never paid or rejected requests',()=>{
 assert.deepEqual(pendingMemberPayouts([
  {member_id:'m',status:'pending',amount:100}, {member_id:'m',status:'paid',amount:9000},
  {member_id:'m',status:'rejected',amount:600}, {member_id:'n',status:'approved',amount:40}
 ],[{member_id:'m',status:'invoice_uploaded',total_amount:250},{member_id:'m',status:'cancelled',total_amount:90}]),{m:350,n:40});
});
test('invalid pending amounts cannot become a plausible balance',()=>{
 for(const amount of [null,'',-1,'invalid']) assert.throws(()=>pendingMemberPayouts([{member_id:'m',status:'pending',amount}],[]));
});
test('hourly load failure does not publish incomplete pending totals',async()=>{
 const result=await loadMemberDirectory(client({fail:'hourly_payout_requests'}),{isAdmin:true,isSuperUser:true});
 assert.equal(result.financeReady,false); assert.equal(result.members.length,1); assert.deepEqual(result.payouts,{});
});

test('directory reads remaining entitlement for each member from the detail source',async()=>{
 const c=client(); const original=c.rpc;
 c.rpc=(name,args)=>name==='get_payout_availability'?(assert.equal(args.p_member_id,'m'),Promise.resolve({data:{projects:[{total_reward:100,paid_payouts:30,available_balance:50,reserved_payouts:20}],realizations:[]}})):original(name,args);
 const result=await loadMemberDirectory(c,{isAdmin:true,isSuperUser:true});
 assert.equal(result.remaining.m,70);assert.equal(result.payouts.m,50);
});
test('failed entitlement lookup is unknown rather than zero',async()=>{
 const result=await loadMemberDirectory(client({fail:'get_payout_availability'}),{isAdmin:true,isSuperUser:true});
 assert.equal(result.remaining.m,null);assert.match(result.financeError,/nároky/);
});
