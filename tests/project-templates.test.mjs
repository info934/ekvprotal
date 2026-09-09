import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectTemplatePayload } from '../src/lib/projectTemplates.js';

test('project template payload trims text and keeps only valid array snapshots', () => {
  assert.deepEqual(normalizeProjectTemplatePayload({
    user_id: 'user-1',
    name: '  Standardní FVE  ',
    description: '  Výchozí struktura  ',
    tasks_data: [{ title: 'Zaměření' }],
    phases_data: null,
  }), {
    user_id: 'user-1',
    name: 'Standardní FVE',
    description: 'Výchozí struktura',
    tasks_data: [{ title: 'Zaměření' }],
    phases_data: [],
  });
});

test('project template updates do not erase omitted task data', () => {
  assert.deepEqual(normalizeProjectTemplatePayload({
    name: 'Přejmenovaná šablona',
    description: '',
  }), {
    name: 'Přejmenovaná šablona',
    description: null,
  });
});

test('project template name cannot be empty after normalization', () => {
  assert.throws(
    () => normalizeProjectTemplatePayload({ name: '   ' }),
    /Název šablony je povinný/,
  );
});
