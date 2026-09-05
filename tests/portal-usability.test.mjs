import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchReportRows } from '../src/lib/reportData.js';
import { fetchPortalSearch } from '../src/lib/portalSearchData.js';

test('report export keeps fetching when server cap is lower than requested page size', async () => {
  const rows = Array.from({ length: 7 }, (_, id) => ({ id: String(id) }));
  const offsets = [];
  const result = await fetchReportRows(() => ({ range(offset) { offsets.push(offset); return Promise.resolve({ data: rows.slice(offset, offset + 2) }); } }));
  assert.deepEqual(result, rows);
  assert.deepEqual(offsets, [0, 2, 4, 6, 7]);
});
test('report export fails instead of returning an incomplete or looping result', async () => {
  await assert.rejects(fetchReportRows(() => ({ range() { return Promise.resolve({ data: [{ id: 'same' }] }); } })), /změnil/);
  await assert.rejects(fetchReportRows(() => ({ range() { return Promise.resolve({ error: new Error('offline') }); } })), /offline/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchReportRows(() => { throw new Error('must not fetch'); }, controller.signal), { name: 'AbortError' });
});
function searchClient(rows) {
  const tables = [];
  return { tables, from(table) { tables.push(table); const q = { then(resolve) { return Promise.resolve({ data: rows }).then(resolve); } }; for (const method of ['select','ilike','order','limit','abortSignal']) q[method] = () => q; return q; } };
}
test('same-name document search links to distinct exact records', async () => {
  const client = searchClient([{ id: 'a', name: 'Zápis KD' }, { id: 'b', name: 'Zápis KD' }]);
  const result = await fetchPortalSearch(client, 'Zápis', module => module === 'documents');
  assert.deepEqual(result.results.map(row => row.path), ['/documents?document=a', '/documents?document=b']);
});
test('employee search only runs with directory permission and uses canonical card links', async () => {
  const client = searchClient([{ id: 'm1', name: 'Test' }]);
  const result = await fetchPortalSearch(client, 'Test', module => module === 'members');
  assert.deepEqual(client.tables, ['members']);
  assert.equal(result.results[0].path, '/members/m1');
  const denied = searchClient([]);
  await fetchPortalSearch(denied, 'Test', () => false);
  assert.deepEqual(denied.tables, []);
});

test('task search opens the existing task detail and requires access to the destination', async () => {
  const client = searchClient([{ id: 't1', name: 'Kontrola', project_id: 'p1' }]);
  const result = await fetchPortalSearch(client, 'Kontrola', module => ['tasks', 'projects'].includes(module));
  assert.equal(result.results.find(row => row.kind === 'Úkol').path, '/projects/p1?task=t1#tasks');
  const denied = searchClient([]);
  await fetchPortalSearch(denied, 'Kontrola', module => module === 'tasks');
  assert.deepEqual(denied.tables, []);
});
