import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

spawnSync(process.execPath, [path.join(root, 'tools', 'generate-llms.js')], {
  cwd: root,
  stdio: 'inherit',
});

const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const result = spawnSync(process.execPath, [viteBin, 'build'], {
  cwd: root,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
