import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const releaseId = `ekvportal-2.0-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
const output = path.join(root, 'output', 'releases');
const snapshot = path.join(output, releaseId);
const rootFiles = new Set([
  'Dockerfile', 'docker-compose.yml', '.dockerignore', '.gitignore', '.npmrc', '.nvmrc', '.version',
  'package.json', 'package-lock.json', 'index.html', 'vite.config.js', 'vite.preview.config.mjs', 'preview.html',
  'tailwind.config.js', 'postcss.config.js', 'jsconfig.json', 'components.json', 'eslint.config.mjs',
]);
const sourcePrefixes = ['src/', 'lib/', 'plugins/', 'public/', 'vendor/', 'tools/', 'tests/', 'deploy/', 'supabase/migrations/', 'supabase/functions/', 'supabase/tests/', 'supabase/checks/'];
const docs = new Set(['docs/DEPLOY_VM_108.md', 'docs/EKVPORTAL_2_0_BACKEND_ROLLOUT.md', 'docs/EKVPORTAL_2_0_IMPLEMENTATION.md', 'docs/SSH_RELEASE_2_0.md', 'docs/SSH_PRISTUP_WINDOWS.md', 'docs/SUPABASE_MIGRACE_2_0.md', 'docs/SUPABASE_MIGRATION_MAINTENANCE.md', 'docs/SUPABASE_LIVE_PREFLIGHT_20260905.md', 'supabase/config.toml', 'supabase/README.md']);
const isSensitivePath = name => /(^|\/)(\.env(?:\.|$)|\.deploy-secrets|ssh-keys|\.git(?:\/|$)|\.temp(?:\/|$)|\.branches(?:\/|$))/.test(name)
  || /(?:_ed25519(?:\.pub)?|\.(?:pem|key|p12|pfx))$/i.test(name)
  || /(^|\/)seed[^/]*\.sql$/.test(name);
const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
const files = [...new Set(listed)].filter(name => !isSensitivePath(name)
  && (rootFiles.has(name) || docs.has(name) || sourcePrefixes.some(prefix => name.startsWith(prefix)))
  && existsSync(path.join(root, name))).sort();

for (const name of ['Dockerfile', 'docker-compose.yml', '.dockerignore', '.npmrc', 'package-lock.json', 'vendor/xlsx-0.20.3.tgz', 'src/main.jsx', 'tools/build.mjs']) {
  if (!files.includes(name)) throw new Error(`Release is missing required build input: ${name}`);
}
if (existsSync(snapshot)) throw new Error(`Release already exists: ${releaseId}`);
mkdirSync(snapshot, { recursive: true });
const records = [];
for (const name of files) {
  if (path.isAbsolute(name) || name.split('/').includes('..')) throw new Error(`Unsafe relative path: ${name}`);
  const source = path.join(root, name);
  if (!lstatSync(source).isFile()) throw new Error(`Only regular files may enter this release: ${name}`);
  const data = readFileSync(source);
  const target = path.join(snapshot, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, data);
  records.push({ path: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
const manifest = {
  releaseId, createdAt: new Date().toISOString(), branch: git(['branch', '--show-current']),
  baseCommit: git(['rev-parse', 'HEAD']), source: 'current working tree including uncommitted source files',
  deploymentStatus: 'prepared only; not uploaded or activated',
  build: 'docker compose --env-file /opt/ekvportal/.env build ekvportal',
  productionPrerequisites: 'Verify database migration history, five 20260905 migrations, and eleven Edge functions described in docs/EKVPORTAL_2_0_BACKEND_ROLLOUT.md before replacing the running frontend.',
  fileCount: records.length, files: records,
};
writeFileSync(path.join(snapshot, 'RELEASE-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const archive = path.join(output, `${releaseId}.tar.gz`);
execFileSync('tar', ['-czf', archive, '-C', output, releaseId], { cwd: root, stdio: 'pipe', windowsHide: true });
const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(`${archive}.sha256`, `${sha256}  ${path.basename(archive)}\n`);
console.log(JSON.stringify({ releaseId, archive, sha256, fileCount: records.length, bytes: lstatSync(archive).size }, null, 2));
