#!/usr/bin/env node
// Applies pending SQL migrations from ./migrations in filename order.
// Safe to run on every start: applied files are recorded in schema_migrations,
// each migration runs in its own transaction, and an advisory lock keeps two
// starting processes from migrating at once.
//
//   node scripts/db-migrate.mjs            apply pending migrations
//   node scripts/db-migrate.mjs --status   list applied / pending, change nothing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv } from './lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(root);

const LOCK_KEY = 74_201_906; // arbitrary, constant per app

export async function migrate({ connectionString = process.env.DATABASE_URL, statusOnly = false, log = console.log } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const dir = path.join(root, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d+.*\.sql$/.test(f)).sort();

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const pending = files.filter((f) => !applied.has(f));

    if (statusOnly) {
      for (const f of files) log(`${applied.has(f) ? 'applied ' : 'PENDING '} ${f}`);
      return { applied: [], pending };
    }

    for (const file of pending) {
      const body = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(body);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`[migrate] applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${error.message}`);
      }
    }
    if (!pending.length) log('[migrate] database is up to date');
    return { applied: pending, pending: [] };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate({ statusOnly: process.argv.includes('--status') }).catch((error) => {
    console.error(`[migrate] ${error.message}`);
    process.exit(1);
  });
}
