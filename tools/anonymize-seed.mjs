#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const inputPath = process.argv[2] || 'supabase/seed.sql';
const outputPath = process.argv[3] || 'supabase/seed.anonymized.sql';

const tablePolicies = {
  members: {
    name: (i) => `Demo člen ${i}`,
    email: (i) => `member-${i}@example.invalid`,
    phone: () => '',
    internal_note: () => '',
    company: () => 'Demo firma',
    job_title: () => 'Demo role',
    department: () => 'Demo',
    bio: () => '',
    avatar_url: () => null,
  },
  subjects: {
    name: (i) => `Demo subjekt ${i}`,
    ico: (i) => `${String(10000000 + i).slice(0, 8)}`,
    dic: (i) => `CZ${String(10000000 + i).slice(0, 8)}`,
    address: (i) => `Demo adresa ${i}, 100 00 Praha`,
    commercial_register: () => '',
    contact_person: (i) => `Demo kontakt ${i}`,
    email: (i) => `subject-${i}@example.invalid`,
    phone: () => '',
    note: () => '',
    birth_date: () => null,
    company_summary: () => '',
    registry_snapshot: () => '{}',
  },
  project_contacts: {
    name: (i) => `Demo kontakt ${i}`,
    role: () => 'Kontakt',
    email: (i) => `project-contact-${i}@example.invalid`,
    phone: () => '',
  },
  projects: {
    name: (i) => `Demo projekt ${i}`,
    location: (i) => `Demo lokalita ${i}`,
    address: (i) => `Demo adresa projektu ${i}`,
    description: () => '',
    notes: () => '',
  },
  realizations: {
    name: (i) => `Demo realizace ${i}`,
    location_address: (i) => `Demo adresa realizace ${i}`,
    location_gps: () => null,
  },
  engineering_subjects: {
    name: (i) => `Demo dotčený subjekt ${i}`,
  },
  audit_logs: {
    user_email: (i) => `audit-user-${i}@example.invalid`,
    details: () => '{}',
  },
  overhead_audit_logs: {
    user_email: (i) => `overhead-audit-user-${i}@example.invalid`,
    details: () => '{}',
  },
};

const sqlString = (value) => {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
};

const splitColumns = (columnsSql) => (
  columnsSql
    .split(',')
    .map((column) => column.trim().replace(/^"|"$/g, ''))
);

const splitTuples = (valuesSql) => {
  const tuples = [];
  let depth = 0;
  let inString = false;
  let start = -1;

  for (let i = 0; i < valuesSql.length; i += 1) {
    const char = valuesSql[i];
    const next = valuesSql[i + 1];

    if (char === "'" && inString && next === "'") {
      i += 1;
      continue;
    }
    if (char === "'") inString = !inString;

    if (!inString && char === '(') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (!inString && char === ')') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tuples.push(valuesSql.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return tuples;
};

const splitValues = (tupleSql) => {
  const body = tupleSql.trim().replace(/^\(/, '').replace(/\)$/, '');
  const values = [];
  let inString = false;
  let current = '';

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    const next = body[i + 1];

    if (char === "'" && inString && next === "'") {
      current += "''";
      i += 1;
      continue;
    }
    if (char === "'") inString = !inString;

    if (!inString && char === ',') {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
};

const anonymizeInsert = (match, tableName, columnsSql, valuesSql) => {
  const policy = tablePolicies[tableName];
  if (!policy) return match;

  const columns = splitColumns(columnsSql);
  const tuples = splitTuples(valuesSql);
  let rowIndex = 0;

  const nextTuples = tuples.map((tuple) => {
    rowIndex += 1;
    const values = splitValues(tuple);
    const nextValues = values.map((value, index) => {
      const column = columns[index];
      const replacement = policy[column];
      return replacement ? sqlString(replacement(rowIndex, value)) : value;
    });
    return `\t(${nextValues.join(', ')})`;
  });

  return `INSERT INTO "public"."${tableName}" (${columnsSql}) VALUES\n${nextTuples.join(',\n')}`;
};

const genericScrub = (sql) => (
  sql
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'redacted@example.invalid')
    .replace(/https:\/\/[^\s')"]+/gi, 'https://example.invalid/redacted')
);

if (!fs.existsSync(inputPath)) {
  console.error(`Input seed not found: ${inputPath}`);
  process.exit(1);
}

const source = fs.readFileSync(inputPath, 'utf8');
const anonymized = genericScrub(source.replace(
  /INSERT INTO "public"\."([a-zA-Z0-9_]+)" \(([^;]+?)\) VALUES\n([\s\S]*?)(?=;\n)/g,
  anonymizeInsert,
));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, anonymized, 'utf8');
console.log(`Wrote anonymized seed to ${outputPath}`);
