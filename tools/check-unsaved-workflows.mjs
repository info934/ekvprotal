import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftSignature, forgetUnsavedDraft, internalFormDestination, readUnsavedDraft, rememberUnsavedDraft } from '../src/lib/unsavedDrafts.js';

test('a browser-back recovery snapshot includes form values and non-form team controls', () => {
  const snapshot = { values: { name: 'Rozpracovaná stavba', contract_amount: 125000 }, teamEntries: [{ member_id: 'a', share_value: 25 }], profitMode: 'fixed' };
  rememberUnsavedDraft('realization:user-a:job-1', snapshot, 1000);
  snapshot.values.name = 'Later mutation';
  const recovered = readUnsavedDraft('realization:user-a:job-1', 1100);
  assert.equal(recovered.snapshot.values.name, 'Rozpracovaná stavba');
  assert.equal(recovered.snapshot.teamEntries[0].share_value, 25);
  assert.equal(recovered.snapshot.profitMode, 'fixed');
  recovered.snapshot.teamEntries[0].share_value = 99;
  assert.equal(readUnsavedDraft('realization:user-a:job-1', 1200).snapshot.teamEntries[0].share_value, 25);
  forgetUnsavedDraft('realization:user-a:job-1');
});

test('drafts cannot leak between accounts, records or project/realization forms', () => {
  rememberUnsavedDraft('project:user-a:new', { values: { name: 'A' } }, 2000);
  for (const key of ['project:user-b:new', 'project:user-a:existing', 'realization:user-a:new']) assert.equal(readUnsavedDraft(key, 2100), null);
  assert.equal(readUnsavedDraft('project:user-a:new', 2100).snapshot.values.name, 'A');
  forgetUnsavedDraft('project:user-a:new');
});

test('successful save or explicit discard removes recovery data', () => {
  rememberUnsavedDraft('discard', { values: { name: 'Draft' } }, 2000);
  forgetUnsavedDraft('discard');
  assert.equal(readUnsavedDraft('discard', 2001), null);
});

test('unused drafts expire after thirty minutes', () => {
  rememberUnsavedDraft('ttl', { values: { name: 'Old' } }, 5000);
  assert.ok(readUnsavedDraft('ttl', 5000 + 30 * 60 * 1000));
  assert.equal(readUnsavedDraft('ttl', 5001 + 30 * 60 * 1000), null);
});

test('memory growth is bounded while the most recent draft remains recoverable', () => {
  for (let index = 0; index < 21; index++) rememberUnsavedDraft(`bounded-${index}`, { index }, 10000 + index);
  assert.equal(readUnsavedDraft('bounded-0', 10100), null);
  assert.equal(readUnsavedDraft('bounded-20', 10100).snapshot.index, 20);
  for (let index = 0; index < 21; index++) forgetUnsavedDraft(`bounded-${index}`);
});

test('dirty comparison includes custom controls and recognises an exact revert', () => {
  const original = { values: { name: 'A' }, investorIsClient: true, selectedTemplateId: '' };
  const changed = { ...original, investorIsClient: false };
  assert.notEqual(draftSignature(original), draftSignature(changed));
  assert.equal(draftSignature(original), draftSignature({ ...changed, investorIsClient: true }));
});

test('same-origin links leaving the form are intercepted with query and tab intact', () => {
  const current = 'https://portal.example/projects/1/edit';
  assert.equal(internalFormDestination('/projects?q=abc#table', current), '/projects?q=abc#table');
  assert.equal(internalFormDestination('../../realizace', current), '/realizace');
  assert.equal(internalFormDestination('/projects/1/edit?crmOpportunityId=2', current), '/projects/1/edit?crmOpportunityId=2');
});

test('in-page anchors, downloads, new tabs, modifiers and external links keep their expected behavior', () => {
  const current = 'https://portal.example/projects/1/edit';
  assert.equal(internalFormDestination('#team', current), null);
  assert.equal(internalFormDestination('/projects/1/edit', current), null);
  assert.equal(internalFormDestination('/projects', current, { target: '_blank' }), null);
  assert.equal(internalFormDestination('/projects', current, { modified: true }), null);
  assert.equal(internalFormDestination('/document.pdf', current, { download: true }), null);
  assert.equal(internalFormDestination('https://other.example/projects', current), null);
  assert.equal(internalFormDestination('mailto:info@example.com', current), null);
  assert.equal(internalFormDestination('javascript:void(0)', current), null);
});
