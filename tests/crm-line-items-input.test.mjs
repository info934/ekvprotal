import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const componentSource = readFileSync(new URL('../src/components/CrmLineItemsTable.jsx', import.meta.url), 'utf8');

test('CRM numeric input keeps keystrokes local and commits only after editing', () => {
  const numericInputStart = componentSource.indexOf('const NumericDraftInput');
  const onChangeStart = componentSource.indexOf('onChange={(event) => {', numericInputStart);
  const onBlurStart = componentSource.indexOf('onBlur={(event) => {', onChangeStart);
  const onKeyDownStart = componentSource.indexOf('onKeyDown={(event) => {', onBlurStart);

  assert.ok(numericInputStart >= 0);
  assert.ok(onChangeStart > numericInputStart);
  assert.ok(onBlurStart > onChangeStart);
  assert.ok(onKeyDownStart > onBlurStart);
  assert.doesNotMatch(componentSource.slice(onChangeStart, onBlurStart), /onValueChange/);
  assert.match(componentSource.slice(onBlurStart, onKeyDownStart), /commit\(event\.target\.value\)/);
});

test('CRM item editor keeps secondary metadata in a compact disclosure', () => {
  const detailsStart = componentSource.indexOf('<details className="group');
  const detailsEnd = componentSource.indexOf('</details>', detailsStart);
  const detailsSource = componentSource.slice(detailsStart, detailsEnd);

  assert.ok(detailsStart >= 0);
  assert.ok(detailsEnd > detailsStart);
  assert.match(detailsSource, /Další údaje/);
  assert.match(detailsSource, /Sekce \/ etapa/);
  assert.match(detailsSource, /Typ položky/);
  assert.match(detailsSource, /group-open:rotate-180/);
});
