import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const checks = [
  {
    name: 'supabase config',
    ok: existsSync(path.join(root, 'supabase', 'config.toml')),
    detail: 'supabase/config.toml',
  },
  {
    name: 'local env example',
    ok: existsSync(path.join(root, '.env.development.example')),
    detail: '.env.development.example',
  },
  {
    name: 'function env example',
    ok: existsSync(path.join(root, 'supabase', '.env.example')),
    detail: 'supabase/.env.example',
  },
];

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
  });

  return {
    ok: result.status === 0,
    output: (result.stdout || result.stderr || '').trim().split('\n')[0] || 'not available',
  };
};

const supabaseBin = process.platform === 'win32'
  ? path.join(root, 'node_modules', 'supabase', 'bin', 'supabase.exe')
  : path.join(root, 'node_modules', '.bin', 'supabase');
const supabase = existsSync(supabaseBin)
  ? { ok: true, output: supabaseBin }
  : { ok: false, output: 'not installed in node_modules' };
checks.push({ name: 'supabase cli', ok: supabase.ok, detail: supabase.output });

const docker = run('docker', ['--version']);
checks.push({ name: 'docker cli', ok: docker.ok, detail: docker.output });

const dockerInfo = run('docker', ['info']);
checks.push({ name: 'docker daemon', ok: dockerInfo.ok, detail: dockerInfo.output });

for (const check of checks) {
  const marker = check.ok ? 'OK' : 'MISSING';
  console.log(`${marker.padEnd(8)} ${check.name}: ${check.detail}`);
}

if (checks.some((check) => !check.ok)) {
  process.exitCode = 1;
}
