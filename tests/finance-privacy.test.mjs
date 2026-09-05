import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  stdin: { contents: "export * from '@/components/finance/FinanceWorkspace'; export {default as FinancialValueGuard} from '@/components/FinancialValueGuard';", resolveDir: root, loader: 'js' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'finance-auth-fixture', setup(builder) {
    builder.onResolve({ filter: /^@\/contexts\/SupabaseAuthContext$/ }, () => ({ path: 'auth', namespace: 'finance-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'finance-fixture' }, () => ({ contents: 'export const useAuth = () => globalThis.__financePrivacyAuth;', loader: 'js' }));
    builder.onResolve({ filter: /^@\// }, args => {
      const path = resolve(root, 'src', args.path.slice(2));
      return { path: [path, `${path}.js`, `${path}.jsx`].find(candidate => existsSync(candidate)) };
    });
  } }],
});
const built = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), built, built.exports);
const { FinanceAmount, FinanceMetricStrip, FinanceStageFlow, FinancialValueGuard } = built.exports;
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test('private amount suppresses both visible currency and exact value tooltip', () => {
  globalThis.__financePrivacyAuth = { isPrivateMode: true, userRole: 'admin' };
  const html = render(FinanceAmount, { value: 123456.78 });
  assert.match(html, /Skryto/); assert.doesNotMatch(html, /title=|123|456|78|Kč/);
});

test('self-scoped worker amounts remain visible when private mode is off; missing is not zero', () => {
  globalThis.__financePrivacyAuth = { isPrivateMode: false, userRole: 'worker' };
  const html = render(FinanceAmount, { value: 450 });
  assert.match(html, /450/); assert.doesNotMatch(html, /Skryto/);
  assert.match(render(FinanceAmount, { value: null }), /Nedostupné/);
});

test('private metric strip suppresses preformatted values, exact tooltips and monetary details', () => {
  globalThis.__financePrivacyAuth = { isPrivateMode: true, userRole: 'admin' };
  const html = render(FinanceMetricStrip, { metrics: [{ label: 'Nárok', value: 'secret-amount', valueTitle: 'secret-tooltip', detail: 'secret-detail' }] });
  assert.match(html, /Nárok/); assert.match(html, /Skryto/); assert.doesNotMatch(html, /secret-/);
});

test('private stage chart suppresses amount labels and ratios; invalid public amounts do not produce NaN widths', () => {
  globalThis.__financePrivacyAuth = { isPrivateMode: true, userRole: 'admin' };
  const privateHtml = render(FinanceStageFlow, { stages: [{ label: 'Nárok', value: 123456, displayValue: 'secret-amount' }] });
  assert.doesNotMatch(privateHtml, /123456|secret-amount|width:/);
  globalThis.__financePrivacyAuth = { isPrivateMode: false, userRole: 'admin' };
  const html = render(FinanceStageFlow, { stages: [{ label: 'A', value: NaN }, { label: 'B', value: 100 }] });
  assert.match(html, /Nedostupné/); assert.doesNotMatch(html, /NaN|Infinity/); assert.match(html, /width:100%/);
});

test('shared financial guard never renders private or unauthorized values in HTML', () => {
 for (const auth of [{isPrivateMode:true,userRole:'admin'},{isPrivateMode:false,userRole:'worker'}]) {
  globalThis.__financePrivacyAuth = auth;
  const html = render(FinancialValueGuard, {value:'123456 Kč'});
  assert.match(html,/Skryto/); assert.doesNotMatch(html,/123456|Kč/);
 }
 globalThis.__financePrivacyAuth = {isPrivateMode:false,userRole:'admin'};
 assert.match(render(FinancialValueGuard,{value:'123456 Kč'}),/123456 Kč/);
});
