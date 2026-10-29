import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { PASSWORD_HASH_ROUNDS } from '@/lib/admin-auth';
import { revokeAccountSessions } from '@/lib/sessions';
import { logActivity } from '@/lib/store';
import { canAssignRole, canManage } from '@/lib/user-permissions';
import {
  deleteUser,
  getUser,
  listLoginEvents,
  listUserSessions,
  temporaryPassword,
  toPublicUser,
  updateUser,
  type UserRole,
} from '@/lib/users';
import { requireAdmin } from '@/lib/viewer';

type Params = { params: Promise<{ userId: string }> };

/** One person: details, signed-in devices and recent sign-in attempts. */
export async function GET(_request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  const user = await getUser(userId);
  if (!user) return NextResponse.json({ ok: false, error: 'המשתמש לא נמצא' }, { status: 404 });
  const [sessions, logins] = await Promise.all([listUserSessions(userId), listLoginEvents({ userId, limit: 20 })]);
  return NextResponse.json({
    ok: true,
    data: { user: toPublicUser(user), sessions, logins, canManage: canManage(auth.session, user) },
  });
}

/** Edit details, role or status. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  const target = await getUser(userId);
  if (!target) return NextResponse.json({ ok: false, error: 'המשתמש לא נמצא' }, { status: 404 });
  if (!canManage(auth.session, target)) {
    return NextResponse.json({ ok: false, error: 'אין לך הרשאה לנהל משתמש זה' }, { status: 403 });
  }

  let body: { name?: string; email?: string; phone?: string; role?: UserRole; active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  if (body.role !== undefined && body.role !== target.role && !canAssignRole(auth.session, body.role)) {
    return NextResponse.json({ ok: false, error: 'רק בעל המערכת יכול לשנות תפקיד למנהל' }, { status: 403 });
  }
  if (userId === auth.session.accountId && body.active === false) {
    return NextResponse.json({ ok: false, error: 'לא ניתן להשבית את החשבון שלך' }, { status: 400 });
  }

  const result = await updateUser(userId, {
    name: body.name,
    email: body.email,
    phone: body.phone,
    role: body.role,
    active: body.active,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, data: toPublicUser(result.user) });
}

/**
 * Actions: { action: 'reset-password' } issues a temporary password (shown once)
 * and signs the person out everywhere; { action: 'sign-out' } just signs them out.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  const target = await getUser(userId);
  if (!target) return NextResponse.json({ ok: false, error: 'המשתמש לא נמצא' }, { status: 404 });
  if (!canManage(auth.session, target) || userId === auth.session.accountId) {
    return NextResponse.json({ ok: false, error: 'אין לך הרשאה לבצע פעולה זו' }, { status: 403 });
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (body.action === 'reset-password') {
    const password = temporaryPassword();
    const result = await updateUser(userId, {
      passwordHash: await bcrypt.hash(password, PASSWORD_HASH_ROUNDS),
      mustChangePassword: true,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    await logActivity({ type: 'user-password-reset', summary: `${auth.session.name || 'מנהל'} הנפיק סיסמה זמנית ל${target.name}` });
    return NextResponse.json({ ok: true, temporaryPassword: password });
  }

  if (body.action === 'sign-out') {
    const ended = await revokeAccountSessions(userId);
    return NextResponse.json({ ok: true, ended });
  }

  return NextResponse.json({ ok: false, error: 'פעולה לא מוכרת' }, { status: 400 });
}

/**
 * Remove a disabled account for good (frees its email). Body: { transferTo }
 * — who takes over the cases and open tasks it still has.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const { userId } = await params;
  const target = await getUser(userId);
  if (!target) return NextResponse.json({ ok: false, error: 'המשתמש לא נמצא' }, { status: 404 });
  if (!canManage(auth.session, target) || userId === auth.session.accountId) {
    return NextResponse.json({ ok: false, error: 'אין לך הרשאה לבצע פעולה זו' }, { status: 403 });
  }
  let body: { transferTo?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const result = await deleteUser(userId, body.transferTo || auth.session.accountId);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, cases: result.cases, tasks: result.tasks });
}
