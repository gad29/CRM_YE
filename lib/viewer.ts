// Bridges the session cookie, or an API key, to the store's visibility model (Node runtime).
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { getCurrentSession, type SessionPayload } from '@/lib/admin-session';
import { bearerToken, KEY_METHOD_HEADER, KEY_PATH_HEADER } from '@/lib/api-access';
import { sessionForApiKey } from '@/lib/api-keys';
import { env } from '@/lib/env';
import type { Viewer } from '@/lib/store';

export function sessionToViewer(session: SessionPayload): Viewer {
  if (session.scope === 'worker' && session.workerId) {
    return { role: 'worker', workerId: session.workerId };
  }
  return { role: 'admin' };
}

/**
 * The session behind "Authorization: Bearer <key>" (a bot), or why the key is
 * refused; undefined when the request carries no key. A request with a key
 * never falls back to the cookie.
 */
export async function apiKeySession() {
  const h = await headers();
  const key = bearerToken(h.get('authorization'));
  if (key === null) return undefined;
  return sessionForApiKey(key, {
    method: h.get(KEY_METHOD_HEADER) || 'GET',
    path: h.get(KEY_PATH_HEADER) || '',
    ip: h.get(env.clientIpHeader)?.split(',').pop()?.trim(),
  });
}

type Auth = { session: SessionPayload; viewer: Viewer };

/** The session + viewer, or why there is none (a refused key says why). */
async function resolveViewer(): Promise<{ auth: Auth } | { error: string }> {
  const fromKey = await apiKeySession();
  if (fromKey && !fromKey.ok) return { error: fromKey.error };
  const session = fromKey ? fromKey.session : await getCurrentSession();
  if (!session) return { error: 'Sign-in required' };
  return { auth: { session, viewer: sessionToViewer(session) } };
}

/** Current session + viewer, or null when unauthenticated (middleware normally prevents that). */
export async function getViewer(): Promise<Auth | null> {
  const result = await resolveViewer();
  return 'auth' in result ? result.auth : null;
}

/** The id recorded in openedBy/createdBy/author fields: the signed-in person's own id. */
export function actorId(session: SessionPayload) {
  return session.accountId;
}

/**
 * Route-handler guard: the live, database-checked session, or a ready 401
 * response. Every API handler calls this (or requireAdmin) — the middleware's
 * cookie check alone does not see revoked sessions.
 */
export async function requireViewer() {
  const result = await resolveViewer();
  if ('error' in result) return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
  return result.auth;
}

/** Like requireViewer, but only for admins (403 for workers). */
export async function requireAdmin() {
  const auth = await requireViewer();
  if (auth instanceof NextResponse) return auth;
  if (auth.viewer.role !== 'admin') return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 });
  return auth;
}

/** Only the business owner (e.g. managing other admins). */
export async function requireOwner() {
  const auth = await requireViewer();
  if (auth instanceof NextResponse) return auth;
  if (auth.session.role !== 'owner') return NextResponse.json({ ok: false, error: 'רק בעל המערכת יכול לבצע פעולה זו' }, { status: 403 });
  return auth;
}
