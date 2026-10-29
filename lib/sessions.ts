// Server-side sessions. The cookie carries a signed session id; the row here
// decides whether it is still valid. Revoking a row (sign-out, deactivation,
// password change) cuts access on the very next request.
import crypto from 'node:crypto';
import { sql, sqlCount, sqlOne } from '@/lib/db';

export type SessionScope = 'admin' | 'worker';

export interface SessionRow {
  id: string;
  scope: SessionScope;
  accountId: string;
  email?: string;
  name?: string;
  expiresAt: string;
  /** Live role from the users table (owner / admin / worker). */
  role?: 'owner' | 'admin' | 'worker';
  mustChangePassword?: boolean;
}

export async function createSession(input: {
  scope: SessionScope;
  accountId: string;
  email?: string;
  name?: string;
  hours: number;
  ip?: string;
  userAgent?: string;
}): Promise<SessionRow> {
  const id = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + input.hours * 60 * 60 * 1000).toISOString();
  await sql(
    `INSERT INTO sessions (id, scope, account_id, email, name, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      input.scope,
      input.accountId,
      input.email ?? null,
      input.name ?? null,
      expiresAt,
      input.ip ?? null,
      input.userAgent ? input.userAgent.slice(0, 300) : null,
    ],
  );
  // Expired rows are useless; sweep them now and then.
  if (Math.random() < 0.05) {
    void sql("DELETE FROM sessions WHERE expires_at < now() - interval '30 days'").catch(() => undefined);
  }
  return { id, scope: input.scope, accountId: input.accountId, email: input.email, name: input.name, expiresAt };
}

/**
 * The live session for `id`, or null when it is unknown, expired, revoked, or
 * belongs to an account that has since been deactivated or deleted.
 */
export async function findActiveSession(id: string): Promise<SessionRow | null> {
  const row = await sqlOne(
    `SELECT s.*, u.active AS account_active, u.role AS account_role, u.name AS account_name,
            u.must_change_password, s.last_seen_at < now() - interval '5 minutes' AS stale
       FROM sessions s JOIN users u ON u.id = s.account_id
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [id],
  );
  if (!row || row.account_active !== true) return null;
  // The scope a session was opened with must still match the person's role.
  const scope: SessionScope = row.account_role === 'worker' ? 'worker' : 'admin';
  if (scope !== row.scope) return null;
  if (row.stale) {
    // Throttled so a busy page doesn't write on every request.
    void sql('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [id]).catch(() => undefined);
  }
  return {
    id: row.id,
    scope: row.scope,
    accountId: row.account_id,
    email: row.email ?? undefined,
    // The current name, so a rename shows up without signing in again.
    name: row.account_name ?? row.name ?? undefined,
    expiresAt: new Date(row.expires_at).toISOString(),
    role: row.account_role,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

/** End every other session of an account (e.g. "sign out my other devices"). */
export async function revokeOtherSessions(accountId: string, keepId: string) {
  return sqlCount('UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND id <> $2 AND revoked_at IS NULL', [
    accountId,
    keepId,
  ]);
}

/** End one session of an account (the account check stops cross-account revokes). */
export async function revokeAccountSession(accountId: string, sessionId: string) {
  return sqlCount('UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND id = $2 AND revoked_at IS NULL', [
    accountId,
    sessionId,
  ]);
}

export async function revokeSession(id: string) {
  await sql('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
}

/** End every open session of one account; returns how many were ended. */
export async function revokeAccountSessions(accountId: string) {
  return sqlCount('UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [accountId]);
}
