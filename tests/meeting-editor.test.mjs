import test from 'node:test';
import assert from 'node:assert/strict';
import {meetingDraftSignature,carryMeetingTasks} from '../src/lib/meetingNotes.js';
test('dirty signature ignores server metadata but tracks text and task links',()=>{
 const d={title:'KD',meeting_date:'2026-09-05',participants:'A',points:[{kind:'task',text:'Ověřit',planning_item_id:'one'}]};
 assert.equal(meetingDraftSignature(d),meetingDraftSignature({...d,version:2,updated_at:'later'}));
 assert.notEqual(meetingDraftSignature(d),meetingDraftSignature({...d,participants:'B'}));
 assert.notEqual(meetingDraftSignature(d),meetingDraftSignature({...d,points:[{...d.points[0],planning_item_id:'two'}]}));
});
test('follow-up preserves open task references, excludes closed and inaccessible tasks',()=>{
 const points=['open','done','missing','cancelled'].map(id=>({kind:'task',text:id,planning_item_id:id}));
 const result=carryMeetingTasks(points,[{id:'open',status:'blocked'},{id:'done',status:'done'},{id:'cancelled',status:'cancelled'}]);
 assert.equal(result.length,1);assert.equal(result[0].planning_item_id,'open');assert.notEqual(result[0],points[0]);
});
