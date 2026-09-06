import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRef = String(process.argv[2] || '').trim();
if (!/^[a-z]{20}$/.test(projectRef)) throw new Error('Usage: node tools/backup-supabase-rest.mjs <project-ref>');

const cli = path.join(root, 'node_modules', '@supabase', 'cli-windows-x64', 'bin', 'supabase.exe');
const keys = JSON.parse(execFileSync(cli, ['projects', 'api-keys', '--project-ref', projectRef, '--output', 'json'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
}));
const serviceKey = keys.find((item) => item.name === 'service_role' && item.api_key)?.api_key;
if (!serviceKey) throw new Error('Supabase service role key is unavailable for this project.');

const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const backupId = `supabase-${projectRef}-${timestamp}`;
const outputRoot = path.join(root, 'output', 'backups');
const staging = path.join(outputRoot, backupId);
const dataDir = path.join(staging, 'public-data');
mkdirSync(dataDir, { recursive: true });

const baseUrl = `https://${projectRef}.supabase.co`;
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/json', 'Accept-Profile': 'public' };
const fetchJson = async (url, options = {}, attempts = 2) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      return { data: await response.json(), headers: response.headers };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

const openApi = await fetchJson(`${baseUrl}/rest/v1/`);
const entities = Object.entries(openApi.data.paths || {})
  .filter(([route, operations]) => /^\/[A-Za-z0-9_]+$/.test(route) && operations?.get)
  .map(([route]) => route.slice(1))
  .sort();

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const records = [];
const failures = [];
const writeEntity = (entity, rows) => {
  const bytes = Buffer.from(`${JSON.stringify(rows)}\n`);
  const fileName = `${entity.replace('.', '_')}.json`;
  writeFileSync(path.join(dataDir, fileName), bytes);
  records.push({ entity, rows: rows.length, bytes: bytes.length, sha256: sha256(bytes) });
};
const backupEntity = async (entity) => {
  try {
    const rows = [];
    let offset = 0;
    const pageSize = 1000;
    let expectedTotal = null;
    while (true) {
      const response = await fetchJson(`${baseUrl}/rest/v1/${encodeURIComponent(entity)}?select=*`, {
        headers: { Range: `${offset}-${offset + pageSize - 1}`, 'Range-Unit': 'items', Prefer: 'count=exact' },
      });
      if (!Array.isArray(response.data)) throw new Error('Response is not a row array.');
      const range = response.headers.get('content-range') || '';
      const totalMatch = /\/(\d+)$/.exec(range);
      if (totalMatch) expectedTotal = Number(totalMatch[1]);
      rows.push(...response.data);
      offset += response.data.length;
      if (!response.data.length || (expectedTotal !== null && offset >= expectedTotal)) break;
    }
    writeEntity(entity, rows);
  } catch (error) {
    try {
      const sql = `select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) as data from public.${entity} t`;
      const result = JSON.parse(execFileSync(cli, ['db', 'query', '--linked', '--output', 'json', sql], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      }));
      const rows = result?.rows?.[0]?.data;
      if (!Array.isArray(rows)) throw new Error('Management API fallback did not return a row array.');
      writeEntity(entity, rows);
    } catch (fallbackError) {
      failures.push({ entity, error: `${error.message}; fallback: ${fallbackError.message}` });
    }
  }
};

let cursor = 0;
await Promise.all(Array.from({ length: Math.min(4, entities.length) }, async () => {
  while (cursor < entities.length) {
    const index = cursor++;
    await backupEntity(entities[index]);
  }
}));

const authUsers = [];
try {
  for (let page = 1; ; page += 1) {
    const response = await fetchJson(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`);
    const users = Array.isArray(response.data?.users) ? response.data.users : [];
    authUsers.push(...users);
    if (users.length < 1000) break;
  }
  writeEntity('auth.users', authUsers);
} catch (error) {
  failures.push({ entity: 'auth.users', error: error.message });
}

const migrations = path.join(root, 'supabase', 'migrations');
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const manifest = {
  backupId,
  createdAt: new Date().toISOString(),
  projectRef,
  gitCommit,
  scope: 'PostgREST-exposed public tables and Supabase Auth user metadata; storage object bytes and password hashes are not included',
  entityCount: records.length,
  totalRows: records.reduce((sum, item) => sum + item.rows, 0),
  records: records.sort((left, right) => left.entity.localeCompare(right.entity)),
  failures,
};
writeFileSync(path.join(staging, 'BACKUP-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
execFileSync('tar', ['-czf', path.join(staging, 'schema-migrations.tar.gz'), '-C', path.dirname(migrations), path.basename(migrations)], { windowsHide: true });

const archive = path.join(outputRoot, `${backupId}.tar.gz`);
execFileSync('tar', ['-czf', archive, '-C', outputRoot, backupId], { windowsHide: true });
const archiveBytes = readFileSync(archive);
const archiveSha256 = sha256(archiveBytes);
writeFileSync(`${archive}.sha256`, `${archiveSha256}  ${path.basename(archive)}\n`);
execFileSync('tar', ['-tzf', archive], { windowsHide: true, stdio: 'ignore' });
rmSync(staging, { recursive: true, force: true });

console.log(JSON.stringify({ backupId, archive, sha256: archiveSha256, entities: records.length, rows: manifest.totalRows, failures: failures.length }, null, 2));
if (failures.length) process.exitCode = 2;
