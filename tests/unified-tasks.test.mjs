import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeWorkTasks,filterWorkTasks,taskQueueFilters,taskExactDate} from '../src/lib/unifiedTasks.js';
const plans=[{plan_id:'p',entity_type:'project',entity_id:'p1'},{plan_id:'r',entity_type:'realization',entity_id:'r1'}];
const items=[{id:'a',plan_id:'p',legacy_project_task_id:'old',name:'Projekt',member_id:'m',status:'in_progress',end_date:'2026-09-05'},{id:'b',plan_id:'r',name:'Montáž',status:'blocked',end_date:'2026-09-04'},{id:'c',plan_id:'r',name:'Hotové',member_id:'m',status:'done',end_date:'2026-09-01'}];
const rows=mergeWorkTasks(plans,items,[{id:'old',name:'Duplicate'},{id:'unlinked',name:'Samostatný',project_id:'p1',status:'Nové'}],[{item_id:'b',member_id:'m'}]);
test('linked tasks appear once; standalone project tasks remain accessible',()=>{assert.equal(rows.length,4);assert(!rows.some(t=>t.name==='Duplicate'));assert(rows.find(t=>t.name==='Montáž').path === '/realizace/r1?planItem=b#plan');assert(rows.find(t=>t.name==='Samostatný').path.includes('?task=unlinked'));});
test('mine includes resource assignments and excludes completed and unassigned tasks',()=>{assert.deepEqual(filterWorkTasks(rows,{scope:'mine',memberId:'m'}).map(t=>t.name),['Montáž','Projekt']);assert.equal(filterWorkTasks(rows,{scope:'mine'}).length,0);});
test('due today is not overdue; completed never counted as overdue',()=>assert.deepEqual(filterWorkTasks(rows,{scope:'overdue',today:'2026-09-05'}).map(t=>t.name),['Montáž']));
test('blocked filter and search combine with discipline',()=>{assert.equal(filterWorkTasks(rows,{scope:'blocked',kind:'realization',search:'montáž'}).length,1);assert.equal(filterWorkTasks(rows,{scope:'blocked',kind:'project'}).length,0);});
test('unknown/inaccessible plan cannot leak through queue',()=>assert.equal(mergeWorkTasks([],items,[]).length,0));

test('unknown URL filters use safe defaults including object prototype names',()=>{
 for(const scope of ['constructor','toString','__proto__','invalid']) assert.equal(taskQueueFilters(new URLSearchParams({scope})).scope,'open');
 assert.equal(taskQueueFilters(new URLSearchParams({kind:'invalid',q:'a'.repeat(500)})).search.length,250);
});
test('task search works without Czech accents',()=>assert.equal(filterWorkTasks(rows,{scope:'all',search:'montaz'}).length,1));
test('exact deadlines include year and reject invalid calendar dates',()=>{
 assert.match(taskExactDate('2026-09-04'),/2026/);
 for(const value of [null,'invalid','2026-02-30','2026-99-01']) assert.equal(taskExactDate(value),'');
});
