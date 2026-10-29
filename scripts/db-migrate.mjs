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
import bcrypt from 'bcryptjs';
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
    await ensureOwner(client, log);
    return { applied: pending, pending: [] };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

/**
 * The business owner signs in like everyone else (email + password). On a
 * fresh or just-upgraded database, create that account from ADMIN_EMAIL and
 * ADMIN_PASSWORD (or ADMIN_PASSWORD_HASH) — the same password as before. After
 * that the owner manages their own password in the app; .env is not consulted.
 */
async function ensureOwner(client, log) {
  const exists = await client.query("SELECT 1 FROM to_regclass('public.users') t WHERE t IS NOT NULL");
  if (!exists.rowCount) return;
  if ((await client.query("SELECT 1 FROM users WHERE role = 'owner'")).rowCount) return;

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const plain = process.env.ADMIN_PASSWORD || '';
  const hash = process.env.ADMIN_PASSWORD_HASH || (plain && !plain.includes('change-me') ? bcrypt.hashSync(plain, 12) : '');
  if (!email.includes('@') || !hash) {
    log('[migrate] WARNING: no owner account yet — set ADMIN_EMAIL and ADMIN_PASSWORD in the server .env and restart');
    return;
  }
  const taken = await client.query('SELECT id FROM users WHERE lower(email) = $1', [email]);
  if (taken.rowCount) {
    // That person already has an account (e.g. an extra admin) — promote it.
    await client.query("UPDATE users SET role = 'owner', updated_at = now() WHERE id = $1", [taken.rows[0].id]);
    log(`[migrate] owner: existing account ${taken.rows[0].id} (${email}) promoted to owner`);
    return;
  }
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO users (id, name, email, role, password_hash, active, created_at, updated_at)
     VALUES ('admin', 'מנהל', $1, 'owner', $2, true, $3, $3)`,
    [email, hash, now],
  );
  log(`[migrate] owner account created for ${email} (same password as ADMIN_PASSWORD)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate({ statusOnly: process.argv.includes('--status') }).catch((error) => {
    console.error(`[migrate] ${error.message}`);
    process.exit(1);
  });
}
