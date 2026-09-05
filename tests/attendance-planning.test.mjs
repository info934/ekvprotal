import test from 'node:test';
import assert from 'node:assert/strict';
import { planPayload, planningTotals, planTime } from '../src/lib/attendancePlanning.js';
const draft={id:'id',date:'2026-09-05',start:'08:00',end:'16:30',break_minutes:30,kind:'work',note:' Test '};
test('plan normalizes times and preserves retry identity',()=>{
 const result=planPayload(draft,'member');
 assert.equal(result.p_start,480);assert.equal(result.p_end,990);assert.equal(result.p_note,'Test');assert.equal(result.p_id,'id');assert.equal(result.p_version,0);
 assert.deepEqual(planPayload(draft,'member'),result);
});
test('work and absence remain separate, cancelled plans are excluded',()=>{
 assert.deepEqual(planningTotals([{start_minute:480,end_minute:990,break_minutes:30,kind:'work'},{start_minute:480,end_minute:600,break_minutes:0,kind:'absence'},{start_minute:480,end_minute:990,break_minutes:30,kind:'home_office',cancelled:true}]),{work:8,absence:2});
});
test('invalid dates, overnight times and excessive breaks are rejected',()=>{
 for(const change of [{date:'2026-02-30'},{end:'07:00'},{start:'25:00'},{break_minutes:510},{break_minutes:-1},{break_minutes:0.5},{kind:'invalid'}])assert.throws(()=>planPayload({...draft,...change},'member'));
 assert.equal(planPayload({...draft,start:'20:00',end:'24:00'},'member').p_end,1440);
 assert.equal(planTime(1440),'24:00');
});
