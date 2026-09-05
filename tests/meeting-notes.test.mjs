import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMeetingNote } from '../src/lib/meetingNotes.js';
const draft={title:'KD 01',meeting_date:'2026-09-05',participants:'Projektant',points:[]};
test('meeting drafts validate dates, text and limits',()=>{
 assert.equal(validateMeetingNote(draft),'');
 for(const patch of [{title:' '},{meeting_date:'2026-02-30'},{participants:'a'.repeat(5001)},{points:[{kind:'invalid',text:'x'}]},{points:[{kind:'decision',text:' '}]}])assert.ok(validateMeetingNote({...draft,...patch}));
});
test('meeting task points require a link instead of silently creating duplicate tasks',()=>{
 assert.ok(validateMeetingNote({...draft,points:[{kind:'task',text:'Zkontrolovat rozvody'}]}));
 assert.equal(validateMeetingNote({...draft,points:[{kind:'task',text:'Zkontrolovat rozvody',planning_item_id:'task-id'}]}),'');
});
