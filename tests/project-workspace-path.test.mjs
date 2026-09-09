import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectWorkspaceYear } from '../src/lib/projectWorkspacePath.js';

test('project workspace year prefers project dates over numeric code segments', () => {
  assert.equal(resolveProjectWorkspaceYear({
    code: 'IZ-12-6005242',
    start_date: '2026-09-01',
    created_at: '2026-09-09T11:17:28Z',
  }), '2026');
});

test('project workspace year uses explicit business-code year only when dates are missing', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  assert.equal(resolveProjectWorkspaceYear({ code: 'OP-26-109' }, now), '2026');
  assert.equal(resolveProjectWorkspaceYear({ code: 'IZ-12-6005242' }, now), '2030');
  assert.equal(resolveProjectWorkspaceYear({ code: 'ARCHIV-2024-A' }, now), '2024');
});
