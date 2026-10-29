import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { revokeAccountSession, revokeOtherSessions } from '@/lib/sessions';
import { requireViewer } from '@/lib/viewer';

/** Sign out one of my devices (?id=…), or all my other devices (no id). */
export async function DELETE(request: NextRequest) {
  const auth = await requireViewer();
  if (auth instanceof NextResponse) return auth;
  const id = request.nextUrl.searchParams.get('id');
  const ended = id
    ? await revokeAccountSession(auth.session.accountId, id)
    : await revokeOtherSessions(auth.session.accountId, auth.session.sid);
  return NextResponse.json({ ok: true, ended });
}
