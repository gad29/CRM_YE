// Bridges the session cookie to the store's visibility model (Node runtime).
import { NextResponse } from 'next/server';
import { getCurrentSession, type SessionPayload } from '@/lib/admin-session';
import type { Viewer } from '@/lib/store';

export function sessionToViewer(session: SessionPayload): Viewer {
  if (session.scope === 'worker' && session.workerId) {
    return { role: 'worker', workerId: session.workerId };
  }
  return { role: 'admin' };
}

/** Current session + viewer, or null when unauthenticated (middleware normally prevents that). */
export async function getViewer(): Promise<{ session: SessionPayload; viewer: Viewer } | null> {
  const session = await getCurrentSession();
  if (!session) return null;
  return { session, viewer: sessionToViewer(session) };
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
  const auth = await getViewer();
  if (!auth) return NextResponse.json({ ok: false, error: 'Sign-in required' }, { status: 401 });
  return auth;
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
