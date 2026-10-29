import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUser, listLoginEvents, listUserSessions, toPublicUser, updateUser } from '@/lib/users';
import { requireViewer } from '@/lib/viewer';

/** The signed-in person: profile, devices and recent sign-ins. */
export async function GET() {
  const auth = await requireViewer();
  if (auth instanceof NextResponse) return auth;
  const user = await getUser(auth.session.accountId);
  if (!user) return NextResponse.json({ ok: false }, { status: 404 });
  const [sessions, logins] = await Promise.all([
    listUserSessions(user.id),
    listLoginEvents({ userId: user.id, limit: 10 }),
  ]);
  return NextResponse.json({
    ok: true,
    data: {
      user: toPublicUser(user),
      sessions: sessions.map((s) => ({ ...s, current: s.id === auth.session.sid })),
      logins,
    },
  });
}

/** Edit my own name / phone; changing the sign-in email needs the current password. */
export async function PATCH(request: NextRequest) {
  const auth = await requireViewer();
  if (auth instanceof NextResponse) return auth;
  let body: { name?: string; phone?: string; email?: string; currentPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  const user = await getUser(auth.session.accountId);
  if (!user) return NextResponse.json({ ok: false }, { status: 404 });

  if (body.email !== undefined && body.email.trim().toLowerCase() !== user.email) {
    if (!body.currentPassword || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      return NextResponse.json({ ok: false, error: 'כדי לשנות אימייל יש להזין את הסיסמה הנוכחית' }, { status: 400 });
    }
  }
  const result = await updateUser(user.id, { name: body.name, phone: body.phone, email: body.email });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, data: toPublicUser(result.user) });
}
