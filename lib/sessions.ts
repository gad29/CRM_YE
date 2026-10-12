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
  credentialTag?: string;
}

export async function createSession(input: {
  scope: SessionScope;
  accountId: string;
  email?: string;
  name?: string;
  hours: number;
  credentialTag?: string;
  ip?: string;
  userAgent?: string;
}): Promise<SessionRow> {
  const id = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + input.hours * 60 * 60 * 1000).toISOString();
  await sql(
    `INSERT INTO sessions (id, scope, account_id, email, name, expires_at, ip, user_agent, credential_tag)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      input.scope,
      input.accountId,
      input.email ?? null,
      input.name ?? null,
      expiresAt,
      input.ip ?? null,
      input.userAgent ? input.userAgent.slice(0, 300) : null,
      input.credentialTag ?? null,
    ],
  );
  // Expired rows are useless; sweep them now and then.
  if (Math.random() < 0.05) {
    void sql("DELETE FROM sessions WHERE expires_at < now() - interval '30 days'").catch(() => undefined);
  }
  return { id, scope: input.scope, accountId: input.accountId, email: input.email, name: input.name, expiresAt, credentialTag: input.credentialTag };
}

/**
 * The live session for `id`, or null when it is unknown, expired, revoked, or
 * belongs to an account that has since been deactivated or deleted.
 */
export async function findActiveSession(id: string): Promise<SessionRow | null> {
  const row = await sqlOne(
    `SELECT s.*,
            CASE
              WHEN s.account_id = 'admin' THEN true
              WHEN s.scope = 'admin' THEN (SELECT a.active FROM admins a WHERE a.id = s.account_id)
              ELSE (SELECT w.active FROM workers w WHERE w.id = s.account_id)
            END AS account_active,
            s.last_seen_at < now() - interval '5 minutes' AS stale
       FROM sessions s
      WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [id],
  );
  if (!row || row.account_active !== true) return null;
  if (row.stale) {
    // Throttled so a busy page doesn't write on every request.
    void sql('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [id]).catch(() => undefined);
  }
  return {
    id: row.id,
    scope: row.scope,
    accountId: row.account_id,
    email: row.email ?? undefined,
    name: row.name ?? undefined,
    expiresAt: new Date(row.expires_at).toISOString(),
    credentialTag: row.credential_tag ?? undefined,
  };
}

export async function revokeSession(id: string) {
  await sql('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
}

/** End every open session of one account; returns how many were ended. */
export async function revokeAccountSessions(accountId: string) {
  return sqlCount('UPDATE sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [accountId]);
}
