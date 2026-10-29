// Session cookie ↔ server-side session (Node runtime: route handlers and server pages).
// One cookie for everyone; `scope` ('admin' | 'worker') follows the person's role.
//
// The cookie (lib/session-token.ts) carries a signed session id + scope; the
// session row in PostgreSQL is what actually grants access, so sign-out,
// deactivation, role and password changes take effect on the very next request.
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { env, isProductionLike } from '@/lib/env';
import { SESSION_COOKIE, signSessionToken, verifySessionToken } from '@/lib/session-token';
import { createSession, findActiveSession, revokeSession, type SessionScope } from '@/lib/sessions';

export { signingSecret } from '@/lib/session-token';

export const ADMIN_AUTH_COOKIE = SESSION_COOKIE;
const DEFAULT_SESSION_HOURS = 24;

export type SessionPayload = {
  sid: string;
  scope: SessionScope;
  /** The signed-in person's user id ('admin' is the owner). */
  accountId: string;
  role: 'owner' | 'admin' | 'worker';
  email?: string;
  /** Set when scope === 'worker'. */
  workerId?: string;
  name?: string;
  /** An admin issued a temporary password — the person must pick their own. */
  mustChangePassword: boolean;
  expiresAt: string;
};

function getSessionHours() {
  const parsed = Number(env.adminSessionHours || DEFAULT_SESSION_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_HOURS;
}

async function resolveToken(token: string | undefined | null): Promise<SessionPayload | null> {
  const verified = await verifySessionToken(token);
  if (!verified) return null;
  const session = await findActiveSession(verified.sid);
  if (!session || session.scope !== verified.scope) return null;
  return {
    sid: session.id,
    scope: session.scope,
    accountId: session.accountId,
    role: session.role ?? (session.scope === 'worker' ? 'worker' : 'admin'),
    email: session.email,
    workerId: session.scope === 'worker' ? session.accountId : undefined,
    name: session.name,
    mustChangePassword: Boolean(session.mustChangePassword),
    expiresAt: session.expiresAt,
  };
}

/** Start a session and return the cookie value to set. */
export async function startSession(input: {
  scope: SessionScope;
  accountId: string;
  email?: string;
  name?: string;
  ip?: string;
  userAgent?: string;
}) {
  const session = await createSession({ ...input, hours: getSessionHours() });
  return signSessionToken(session.id, session.scope);
}

/** Revoke the session behind a cookie value (sign-out). */
export async function endSession(token: string | undefined | null) {
  const verified = await verifySessionToken(token);
  if (verified) await revokeSession(verified.sid);
}

export async function getSessionFromRequest(request: NextRequest): Promise<SessionPayload | null> {
  return resolveToken(request.cookies.get(ADMIN_AUTH_COOKIE)?.value);
}

/** Session in a server component / route handler context (reads cookies()). */
export async function getCurrentSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return resolveToken(cookieStore.get(ADMIN_AUTH_COOKIE)?.value);
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProductionLike(),
    path: '/',
    maxAge: getSessionHours() * 60 * 60,
  };
}
