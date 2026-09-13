import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cli = path.join(root, 'node_modules', '@supabase', 'cli-windows-x64', 'bin', 'supabase.exe');
const projectRef = 'yurysbxxevtuvhrbmloc';
const query = JSON.parse(execFileSync(cli, [
  'db', 'query', '--linked', '--output', 'json',
  "select decrypted_secret from vault.decrypted_secrets where name = 'realization_retention_cron_secret'",
], { cwd: root, encoding: 'utf8', windowsHide: true }));
const secret = query?.rows?.[0]?.decrypted_secret;
const keys = JSON.parse(execFileSync(cli, ['projects', 'api-keys', '--project-ref', projectRef, '--output', 'json'], {
  cwd: root, encoding: 'utf8', windowsHide: true,
}));
const anonKey = keys.find((item) => item.name === 'anon')?.api_key;
if (!secret || !anonKey) throw new Error('Operational credentials are unavailable.');
const headers = { apikey: anonKey, 'x-realization-retention-secret': secret, 'Content-Type': 'application/json' };
const baseUrl = `https://${projectRef}.supabase.co/functions/v1`;
const invoke = async (name, body) => {
  const response = await fetch(`${baseUrl}/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(`${name}: ${result.error || `HTTP ${response.status}`}`);
  return result;
};

const summary = await invoke('send-realization-retention-summary', { action: 'test' });
const source = path.join(root, 'output', 'pdf', 'lookbook-2026-09');
const attachments = readdirSync(source).filter((name) => /^\d{2}-.*\.pdf$/i.test(name)).sort().map((filename) => ({
  filename, content: readFileSync(path.join(source, filename)).toString('base64'),
}));
const lookbook = await invoke('send-document-lookbook', {
  attachments, idempotencyKey: 'document-lookbook:2026-09-13:final-v1',
});
console.log(JSON.stringify({ summary, lookbook }, null, 2));
