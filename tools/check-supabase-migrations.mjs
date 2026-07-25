import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const migrationsDirectory = path.resolve('supabase', 'migrations');
const migrationPattern = /^(\d{14})_[a-z0-9_]+\.sql$/;
const files = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith('.sql'))
  .sort();

const errors = [];
const versions = new Map();
const contentHashes = new Map();

for (const file of files) {
  const match = file.match(migrationPattern);
  if (!match) {
    errors.push(`${file}: expected YYYYMMDDHHMMSS_snake_case.sql`);
    continue;
  }

  const version = match[1];
  const previousVersionFile = versions.get(version);
  if (previousVersionFile) {
    errors.push(`${file}: duplicate version also used by ${previousVersionFile}`);
  } else {
    versions.set(version, file);
  }

  const contents = await readFile(path.join(migrationsDirectory, file));
  const hash = createHash('sha256').update(contents).digest('hex');
  const previousContentFile = contentHashes.get(hash);
  if (previousContentFile) {
    errors.push(`${file}: duplicate content also found in ${previousContentFile}`);
  } else {
    contentHashes.set(hash, file);
  }
}

if (errors.length > 0) {
  console.error('Supabase migration validation failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Supabase migrations OK: ${files.length} timestamped files, no duplicate versions or contents.`,
);
