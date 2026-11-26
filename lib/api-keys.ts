// API keys: how a program (an AI bot, an automation) signs in without a
// browser. A key acts as one team account, so it sees and may do exactly what
// that person may, and stops working when the account is deactivated. A key
// is read-only unless it was created with write access; deleting is never
// possible with a key (lib/api-access.ts).
//
// Only a SHA-256 of the key is stored. The key itself is shown once, when
// it is created.
import crypto from 'node:crypto';
import type { SessionPayload } from '@/lib/admin-session';
import { API_KEY_PREFIX, isReadMethod } from '@/lib/api-access';
import { iso, isoOpt, sql, sqlOne } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

/** Requests per key per 10 minutes. A bot answering one question makes a handful. */
const KEY_RATE_LIMIT = 1200;

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  accountId: string;
  accountName: string;
  accountRole: 'owner' | 'admin' | 'worker';
  accountActive: boolean;
  canWrite: boolean;
  createdBy?: string;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
  lastUsedIp?: string;
  revokedAt?: string;
}

export interface ApiKeyRequest {
  keyId: string;
  keyName: string;
  at: string;
  method: string;
  path: string;
}

function hashKey(key: string) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function toRecord(row: Record<string, unknown>): ApiKeyRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    prefix: row.prefix as string,
    accountId: row.account_id as string,
    accountName: (row.account_name as string) ?? '',
    accountRole: row.account_role as ApiKeyRecord['accountRole'],
    accountActive: row.account_active === true,
    canWrite: row.can_write === true,
    createdBy: (row.created_by as string) ?? undefined,
    createdAt: iso(row.created_at as Date),
    expiresAt: isoOpt(row.expires_at as Date | null),
    lastUsedAt: isoOpt(row.last_used_at as Date | null),
    lastUsedIp: (row.last_used_ip as string) ?? undefined,
    revokedAt: isoOpt(row.revoked_at as Date | null),
  };
}

const SELECT_KEYS = `SELECT k.*, u.name AS account_name, u.role AS account_role, u.active AS account_active
                       FROM api_keys k JOIN users u ON u.id = k.account_id`;

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const rows = await sql(`${SELECT_KEYS} ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`);
  return rows.map(toRecord);
}

export async function getApiKey(id: string): Promise<ApiKeyRecord | undefined> {
  const row = await sqlOne(`${SELECT_KEYS} WHERE k.id = $1`, [id]);
  return row ? toRecord(row) : undefined;
}

/** Create a key; returns the record and the key itself (shown to the person once). */
export async function createApiKey(input: { name: string; accountId: string; canWrite: boolean; createdBy: string; expiresInDays?: number }) {
  const key = `${API_KEY_PREFIX}${crypto.randomBytes(30).toString('base64url')}`;
  const id = crypto.randomUUID();
  const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString() : null;
  await sql(
    `INSERT INTO api_keys (id, name, prefix, key_hash, account_id, can_write, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, input.name.trim().slice(0, 80), key.slice(0, API_KEY_PREFIX.length + 6), hashKey(key), input.accountId, input.canWrite, input.createdBy, expiresAt],
  );
  return { record: (await getApiKey(id)) as ApiKeyRecord, key };
}

export async function revokeApiKey(id: string) {
  const rows = await sql('UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id', [id]);
  return rows.length > 0;
}

export async function recentKeyRequests(limit = 40): Promise<ApiKeyRequest[]> {
  const rows = await sql(
    `SELECT r.key_id, k.name AS key_name, r.at, r.method, r.path
       FROM api_key_requests r JOIN api_keys k ON k.id = r.key_id
      ORDER BY r.at DESC, r.id DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ keyId: r.key_id, keyName: r.key_name, at: iso(r.at), method: r.method, path: r.path }));
}

export type KeyCheck = { ok: true; session: SessionPayload; canWrite: boolean; keyName: string } | { ok: false; error: string };

/**
 * The session a key stands for on this request, or why it is refused. Checks
 * the key is known, not revoked or expired, that its account is still active,
 * that a read-only key is only reading, and the per-key rate limit.
 */
export async function sessionForApiKey(key: string, request: { method: string; path: string; ip?: string }): Promise<KeyCheck> {
  if (!key.startsWith(API_KEY_PREFIX)) return { ok: false, error: 'מפתח API לא תקין' };
  const row = await sqlOne(
    `${SELECT_KEYS} WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > now())`,
    [hashKey(key)],
  );
  if (!row) return { ok: false, error: 'מפתח API לא תקין, בוטל או שפג תוקפו' };
  const record = toRecord(row);
  if (!record.accountActive) return { ok: false, error: 'החשבון שהמפתח פועל בשמו מושבת' };

  // The MCP endpoint itself is a POST for every call, reads included; the
  // tools it runs come back through here with their real method.
  const isMcp = request.path === '/api/mcp';
  if (!record.canWrite && !isMcp && !isReadMethod(request.method)) {
    return { ok: false, error: 'המפתח הזה לקריאה בלבד' };
  }
  if (!(await consumeRateLimit(`api-key:${record.id}`, KEY_RATE_LIMIT, 600))) {
    return { ok: false, error: 'יותר מדי בקשות מהמפתח הזה. נסו שוב בעוד כמה דקות' };
  }

  // MCP calls are logged as the requests they turn into, not twice.
  if (!isMcp) {
    void sql('INSERT INTO api_key_requests (key_id, method, path) VALUES ($1, $2, $3)', [record.id, request.method.toUpperCase(), request.path.slice(0, 300)]).catch(() => undefined);
    if (Math.random() < 0.01) {
      void sql("DELETE FROM api_key_requests WHERE at < now() - interval '60 days'").catch(() => undefined);
    }
  }
  const stale = !record.lastUsedAt || Date.now() - new Date(record.lastUsedAt).getTime() > 60_000;
  if (stale || (request.ip && request.ip !== 'unknown' && request.ip !== record.lastUsedIp)) {
    void sql('UPDATE api_keys SET last_used_at = now(), last_used_ip = COALESCE($2, last_used_ip) WHERE id = $1', [
      record.id,
      request.ip && request.ip !== 'unknown' ? request.ip : null,
    ]).catch(() => undefined);
  }

  const role = record.accountRole;
  return {
    ok: true,
    canWrite: record.canWrite,
    keyName: record.name,
    session: {
      sid: `api-key:${record.id}`,
      scope: role === 'worker' ? 'worker' : 'admin',
      accountId: record.accountId,
      role,
      workerId: role === 'worker' ? record.accountId : undefined,
      name: record.accountName,
      mustChangePassword: false,
      expiresAt: record.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
    },
  };
}
