import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectTemplateData,
  getProjectTemplateFormValues,
  normalizeProjectTemplatePayload,
} from '../src/lib/projectTemplates.js';

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

test('project template stores reusable parties and settings but excludes project identity', () => {
  assert.deepEqual(buildProjectTemplateData({
    id: 'project-1',
    name: 'Původní zakázka',
    code: 'OP-26-999',
    price: 500000,
    start_date: '2026-09-01',
    completion_date: '2026-10-01',
    type: 'FVE',
    stage_id: 'stage-1',
    created_by_member_id: 'member-1',
    investor_id: 'subject-1',
    client_id: 'subject-2',
    investor: { id: 'subject-1', name: 'Investor s.r.o.', ico: '12345678' },
    client: { id: 'subject-2', name: 'Zadavatel a.s.' },
    location: 'Praha',
    brief: 'Projektové zadání',
    is_priority: true,
    budget_percentage: 30,
    overhead_percentage: 10,
  }), {
    schema_version: 1,
    type: 'FVE',
    stage_id: 'stage-1',
    created_by_member_id: 'member-1',
    location: 'Praha',
    brief: 'Projektové zadání',
    investor_id: 'subject-1',
    client_id: 'subject-2',
    is_priority: true,
    budget_percentage: 30,
    overhead_percentage: 10,
    investor_is_client: false,
    subjects: {
      investor: { id: 'subject-1', name: 'Investor s.r.o.', ico: '12345678' },
      client: { id: 'subject-2', name: 'Zadavatel a.s.' },
    },
  });
});

test('financial template defaults are exposed only when explicitly allowed', () => {
  const projectData = {
    investor_id: 'subject-1',
    budget_percentage: 35,
    overhead_percentage: 12,
  };
  assert.deepEqual(getProjectTemplateFormValues(projectData), {
    investor_id: 'subject-1',
  });
  assert.deepEqual(getProjectTemplateFormValues(projectData, { includeFinancialDefaults: true }), {
    investor_id: 'subject-1',
    budget_percentage: 35,
    overhead_percentage: 12,
  });
});
