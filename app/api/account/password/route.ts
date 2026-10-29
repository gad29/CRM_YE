import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { MIN_PASSWORD_LENGTH, PASSWORD_HASH_ROUNDS } from '@/lib/admin-auth';
import { consumeRateLimit } from '@/lib/rate-limit';
import { revokeOtherSessions } from '@/lib/sessions';
import { getUser, setOwnPassword } from '@/lib/users';
import { requireViewer } from '@/lib/viewer';

/**
 * Change my password. Other devices are signed out; this one stays signed in.
 * Also how a temporary password issued by an admin gets replaced.
 */
export async function POST(request: NextRequest) {
  const auth = await requireViewer();
  if (auth instanceof NextResponse) return auth;
  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (next.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ ok: false, error: `הסיסמה החדשה צריכה להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים` }, { status: 400 });
  }
  if (!(await consumeRateLimit(`password-change:${auth.session.accountId}`, 10, 15 * 60))) {
    return NextResponse.json({ ok: false, error: 'יותר מדי ניסיונות. נסו שוב בעוד 15 דקות.' }, { status: 429 });
  }

  const user = await getUser(auth.session.accountId);
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
    return NextResponse.json({ ok: false, error: 'הסיסמה הנוכחית שגויה' }, { status: 400 });
  }
  if (await bcrypt.compare(next, user.passwordHash)) {
    return NextResponse.json({ ok: false, error: 'הסיסמה החדשה זהה לנוכחית' }, { status: 400 });
  }

  await setOwnPassword(user.id, await bcrypt.hash(next, PASSWORD_HASH_ROUNDS));
  const ended = await revokeOtherSessions(user.id, auth.session.sid);
  return NextResponse.json({ ok: true, otherDevicesSignedOut: ended });
}
