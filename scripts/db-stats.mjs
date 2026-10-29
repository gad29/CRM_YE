#!/usr/bin/env node
// Prints row counts of every CRM table as JSON — written into backup manifests
// and compared after a restore.
//   node scripts/db-stats.mjs            → {"clients":158,…}
//   node scripts/db-stats.mjs --empty    → exit 0 if the CRM tables are empty/absent, 1 otherwise
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from './lib/env.mjs';

loadEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));

const TABLES = [
  'clients', 'cases', 'case_checklist_items', 'documents', 'payments', 'tasks', 'users', 'login_events',
  'activity', 'chat_channels', 'chat_messages', 'app_kv', 'counters', 'notification_log',
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const counts = {};
  for (const table of TABLES) {
    const exists = (await client.query('SELECT to_regclass($1) AS t', [`public.${table}`])).rows[0].t;
    counts[table] = exists ? Number((await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n) : null;
  }
  if (process.argv.includes('--empty')) {
    // A fresh install already has its owner account, so users don't count as data here.
    const used = ['clients', 'cases', 'documents', 'activity'].some((t) => counts[t]);
    process.exit(used ? 1 : 0);
  }
  console.log(JSON.stringify(counts));
} finally {
  await client.end();
}
