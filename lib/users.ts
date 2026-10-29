// Everyone who signs in: the owner, admins and workers (one `users` table).
//
// Roles
//   owner  — the business owner. Exactly one. Can do everything, including
//            managing admins. Cannot be deactivated or demoted.
//   admin  — full access to all clients, cases, payments and settings; manages
//            workers (not other admins).
//   worker — sees and handles only the cases they handle.
import crypto from 'node:crypto';
import { iso, isoOpt, opt, sql, sqlOne, transaction } from '@/lib/db';
import { passwordResetMessage } from '@/lib/messages';
import { deliver, directChannelAvailable, type DeliveryChannel } from '@/lib/notify';
import { consumeRateLimit } from '@/lib/rate-limit';
import { revokeAccountSessions } from '@/lib/sessions';
import { getConfig, logActivity, nextId } from '@/lib/store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type UserRole = 'owner' | 'admin' | 'worker';

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'בעלים',
  admin: 'מנהל',
  worker: 'עובד',
};

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
  passwordHash: string;
}

/** A user as it may leave the server (never the password hash). */
export type PublicUser = Omit<UserRecord, 'passwordHash'>;

export function isAdminRole(role: UserRole) {
  return role === 'owner' || role === 'admin';
}

export function toPublicUser({ passwordHash: _hash, ...user }: UserRecord): PublicUser {
  return user;
}

function toUser(row: Row): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: opt(row.phone),
    role: row.role,
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.must_change_password),
    lastLoginAt: isoOpt(row.last_login_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    passwordHash: row.password_hash,
  };
}

const ROLE_ORDER = "CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END";

export async function listUsers(): Promise<UserRecord[]> {
  return (await sql(`SELECT * FROM users ORDER BY ${ROLE_ORDER}, active DESC, name`)).map(toUser);
}

export async function getUser(id: string): Promise<UserRecord | undefined> {
  const row = await sqlOne('SELECT * FROM users WHERE id = $1', [id]);
  return row ? toUser(row) : undefined;
}

export async function getUserByEmail(email: string): Promise<UserRecord | undefined> {
  const row = await sqlOne('SELECT * FROM users WHERE lower(email) = lower($1)', [email.trim()]);
  return row ? toUser(row) : undefined;
}

export async function createUser(input: {
  name: string;
  email: string;
  phone?: string;
  role: Exclude<UserRole, 'owner'>;
  passwordHash: string;
  mustChangePassword?: boolean;
}): Promise<{ ok: true; user: UserRecord } | { ok: false; error: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email.includes('@')) return { ok: false, error: 'שם ואימייל תקין הם שדות חובה' };
  if (await getUserByEmail(email)) return { ok: false, error: 'כבר קיים משתמש עם האימייל הזה' };

  // Ids keep the prefixes the CRM has always used (ADM-11, WRK-101).
  const id = input.role === 'admin' ? await nextId('ADM', 'admin', 10) : await nextId('WRK', 'worker', 100);
  const now = new Date().toISOString();
  const row = await sqlOne(
    `INSERT INTO users (id, name, email, phone, role, password_hash, active, must_change_password, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $8) RETURNING *`,
    [id, name, email, input.phone?.trim() || null, input.role, input.passwordHash, Boolean(input.mustChangePassword), now],
  );
  await logActivity({ type: 'user-created', summary: `נוסף ${ROLE_LABELS[input.role]}: ${name} (${email})` });
  return { ok: true, user: toUser(row!) };
}

export async function updateUser(
  id: string,
  input: {
    name?: string;
    email?: string;
    phone?: string;
    role?: UserRole;
    active?: boolean;
    passwordHash?: string;
    mustChangePassword?: boolean;
  },
): Promise<{ ok: true; user: UserRecord } | { ok: false; error: string }> {
  const current = await getUser(id);
  if (!current) return { ok: false, error: 'המשתמש לא נמצא' };

  const next = { ...current };
  if (input.name !== undefined && input.name.trim()) next.name = input.name.trim();
  if (input.phone !== undefined) next.phone = input.phone.trim() || undefined;
  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    if (!email.includes('@')) return { ok: false, error: 'כתובת אימייל לא תקינה' };
    const other = await getUserByEmail(email);
    if (other && other.id !== id) return { ok: false, error: 'כבר קיים משתמש עם האימייל הזה' };
    next.email = email;
  }
  if (input.role !== undefined) next.role = input.role;
  if (input.active !== undefined) next.active = input.active;
  if (input.passwordHash) next.passwordHash = input.passwordHash;
  if (input.mustChangePassword !== undefined) next.mustChangePassword = input.mustChangePassword;
  // The owner is permanent: never demoted, never switched off.
  if (current.role === 'owner' && (next.role !== 'owner' || !next.active)) {
    return { ok: false, error: 'לא ניתן להשבית את בעל המערכת או לשנות את תפקידו' };
  }
  if (next.role === 'owner' && current.role !== 'owner') return { ok: false, error: 'יש רק בעלים אחד למערכת' };

  const row = await sqlOne(
    `UPDATE users SET name = $2, email = $3, phone = $4, role = $5, active = $6, password_hash = $7,
            must_change_password = $8, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, next.name, next.email, next.phone ?? null, next.role, next.active, next.passwordHash, next.mustChangePassword],
  );

  // Anything that changes who may do what ends the person's open sessions.
  if (!next.active || input.passwordHash || next.role !== current.role) await revokeAccountSessions(id);
  if (input.active !== undefined && input.active !== current.active) {
    await logActivity({ type: 'user-updated', summary: `${next.name} ${next.active ? 'הופעל/ה' : 'הושבת/ה'}` });
  }
  if (next.role !== current.role) {
    await logActivity({ type: 'user-updated', summary: `התפקיד של ${next.name} שונה ל${ROLE_LABELS[next.role]}` });
  }
  return { ok: true, user: toUser(row!) };
}

/**
 * A person changing their own password. Unlike updateUser it does not end
 * every session — the caller signs out the *other* devices and keeps this one.
 */
export async function setOwnPassword(userId: string, passwordHash: string) {
  await sql('UPDATE users SET password_hash = $2, must_change_password = false, updated_at = now() WHERE id = $1', [
    userId,
    passwordHash,
  ]);
}

/** A readable temporary password, e.g. "kite-4827-rose" — shown to the admin once. */
export function temporaryPassword() {
  const words = ['sun', 'kite', 'rose', 'lake', 'oak', 'mint', 'star', 'wave', 'pine', 'bird', 'leaf', 'moon'];
  const pick = () => words[crypto.randomInt(words.length)];
  return `${pick()}-${crypto.randomInt(1000, 10000)}-${pick()}`;
}

export async function recordLogin(userId: string) {
  await sql('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
}

export async function logLoginEvent(input: { userId?: string; email: string; success: boolean; reason?: string; ip?: string; userAgent?: string }) {
  await sql('INSERT INTO login_events (user_id, email, success, reason, ip, user_agent) VALUES ($1, $2, $3, $4, $5, $6)', [
    input.userId ?? null,
    input.email.slice(0, 200),
    input.success,
    input.reason ?? null,
    input.ip ?? null,
    input.userAgent ? input.userAgent.slice(0, 300) : null,
  ]);
  if (Math.random() < 0.02) {
    void sql("DELETE FROM login_events WHERE at < now() - interval '1 year'").catch(() => undefined);
  }
}

export interface LoginEvent {
  id: number;
  userId?: string;
  email: string;
  success: boolean;
  reason?: string;
  ip?: string;
  userAgent?: string;
  at: string;
}

export async function listLoginEvents(options: { userId?: string; limit?: number } = {}): Promise<LoginEvent[]> {
  const rows = options.userId
    ? await sql('SELECT * FROM login_events WHERE user_id = $1 ORDER BY at DESC LIMIT $2', [options.userId, options.limit ?? 30])
    : await sql('SELECT * FROM login_events ORDER BY at DESC LIMIT $1', [options.limit ?? 50]);
  return rows.map((r) => ({
    id: Number(r.id),
    userId: opt(r.user_id),
    email: r.email,
    success: r.success,
    reason: opt(r.reason),
    ip: opt(r.ip),
    userAgent: opt(r.user_agent),
    at: iso(r.at),
  }));
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip?: string;
  userAgent?: string;
}

/** Signed-in devices of one person (not expired, not revoked). */
export async function listUserSessions(userId: string): Promise<SessionSummary[]> {
  const rows = await sql(
    `SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions
      WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > now()
      ORDER BY last_seen_at DESC`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, createdAt: iso(r.created_at), lastSeenAt: iso(r.last_seen_at), ip: opt(r.ip), userAgent: opt(r.user_agent) }));
}

/** Number of signed-in devices per user (for the users list). */
export async function activeSessionCounts(): Promise<Map<string, number>> {
  const rows = await sql<{ account_id: string; n: number }>(
    `SELECT account_id, count(*)::int AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > now() GROUP BY account_id`,
  );
  return new Map(rows.map((r) => [r.account_id, r.n]));
}

// ── Directory used by cases, tasks and chat ─────────────────────────────────

export interface PersonEntry {
  id: string;
  name: string;
  role: 'admin' | 'worker';
  active: boolean;
  email?: string;
  phone?: string;
}

/** Everyone a case or task can belong to, keyed by id ('admin' is the owner). */
export async function personDirectory(): Promise<Map<string, PersonEntry>> {
  const users = await listUsers();
  return new Map(
    users.map((u) => [
      u.id,
      { id: u.id, name: u.name, role: isAdminRole(u.role) ? 'admin' : 'worker', active: u.active, email: u.email, phone: u.phone },
    ]),
  );
}

/** Contact details for a task assignee. */
export async function assigneeContact(assigneeId: string) {
  const user = await getUser(assigneeId);
  if (!user) return { id: assigneeId, name: assigneeId, email: '', phone: '' };
  return { id: user.id, name: user.name, email: user.email, phone: user.phone || '' };
}

// ── Password reset codes (email / WhatsApp) ──────────────────────────────────

const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_COOLDOWN_MS = 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;
/** Codes per account per day — stops someone cycling fresh codes to brute-force. */
const RESET_DAILY_LIMIT = 6;

function hashResetCode(code: string) {
  return crypto.createHash('sha256').update(`crmye-reset:${code}`).digest('hex');
}

/**
 * Creates a reset code for the account behind `email` and delivers it on the
 * requested channel. Always behaves the same externally so emails can't be
 * enumerated.
 */
export async function requestPasswordReset(email: string, channel: DeliveryChannel) {
  const normalized = email.trim().toLowerCase();
  const account = await getUserByEmail(normalized);
  if (!account || !account.active) return { ok: true, sent: false } as const;
  if (!directChannelAvailable(channel)) return { ok: true, sent: false } as const;

  await sql('DELETE FROM password_resets WHERE expires_at < now()');
  const recent = await sqlOne('SELECT 1 FROM password_resets WHERE email = $1 AND created_at > $2', [
    normalized,
    new Date(Date.now() - RESET_COOLDOWN_MS).toISOString(),
  ]);
  if (recent) return { ok: true, sent: false } as const;
  if (!(await consumeRateLimit(`reset-daily:${normalized}`, RESET_DAILY_LIMIT, 24 * 60 * 60))) {
    return { ok: true, sent: false } as const;
  }

  const code = String(crypto.randomInt(100000, 1000000));
  await transaction(async () => {
    await sql('DELETE FROM password_resets WHERE email = $1', [normalized]);
    await sql(
      `INSERT INTO password_resets (id, account_type, account_id, email, code_hash, expires_at, attempts, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, now())`,
      [crypto.randomUUID(), account.role, account.id, normalized, hashResetCode(code), new Date(Date.now() + RESET_TTL_MS).toISOString()],
    );
  });

  await logActivity({ type: 'password-reset-requested', summary: `התבקש איפוס סיסמה עבור ${account.name}` });
  const { businessName } = await getConfig();
  await deliver({
    channel,
    to: { email: account.email, phone: account.phone },
    message: passwordResetMessage({ businessName, name: account.name, code, minutes: 15 }),
    relatedId: account.id,
  });
  return { ok: true, sent: true } as const;
}

/** Verifies the code and sets the new password hash. Consumes the reset on success. */
export async function completePasswordReset(email: string, code: string, newPasswordHash: string) {
  const normalized = email.trim().toLowerCase();
  const outcome = await transaction(async () => {
    const record = await sqlOne('SELECT * FROM password_resets WHERE email = $1 AND expires_at > now() FOR UPDATE', [normalized]);
    if (!record) return { ok: false, error: 'קוד לא תקין או שפג תוקפו' } as const;
    if (record.attempts >= RESET_MAX_ATTEMPTS) {
      await sql('DELETE FROM password_resets WHERE id = $1', [record.id]);
      return { ok: false, error: 'יותר מדי ניסיונות — בקשו קוד חדש' } as const;
    }
    const given = Buffer.from(hashResetCode(code.trim()));
    const expected = Buffer.from(String(record.code_hash));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      await sql('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [record.id]);
      return { ok: false, error: 'הקוד שגוי' } as const;
    }
    await sql('DELETE FROM password_resets WHERE id = $1', [record.id]);
    return { ok: true, accountId: record.account_id as string } as const;
  });
  if (!outcome.ok) return outcome;

  const updated = await updateUser(outcome.accountId, { passwordHash: newPasswordHash, mustChangePassword: false });
  if (!updated.ok) return { ok: false, error: updated.error } as const;
  await logActivity({ type: 'password-reset-completed', summary: `אופסה סיסמה עבור ${updated.user.name}` });
  return { ok: true } as const;
}
