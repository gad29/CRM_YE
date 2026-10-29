#!/usr/bin/env node
// Emergency access for the business owner, run on the server itself:
//
//   npm run owner:reset
//
// Sets a new temporary password on the owner account (printed once), makes the
// owner choose their own at the next sign-in, and signs the owner out of every
// device. Use it only when the "forgot password" screen cannot reach the owner.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { loadEnv } from './lib/env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(root);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const owner = await client.query("SELECT id, email FROM users WHERE role = 'owner'");
    if (!owner.rowCount) throw new Error('no owner account — run npm run db:migrate with ADMIN_EMAIL and ADMIN_PASSWORD set');
    const { id, email } = owner.rows[0];
    const temporary = `${crypto.randomBytes(4).toString('hex')}-${crypto.randomInt(1000, 10000)}`;
    await client.query('BEGIN');
    await client.query(
      'UPDATE users SET password_hash = $1, must_change_password = true, active = true, updated_at = now() WHERE id = $2',
      [bcrypt.hashSync(temporary, 12), id],
    );
    await client.query('UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [id]);
    await client.query('COMMIT');
    console.log(`Owner: ${email}`);
    console.log(`Temporary password: ${temporary}`);
    console.log('Sign in with it; the app will ask for a new password.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[owner:reset] ${error.message}`);
  process.exit(1);
});
