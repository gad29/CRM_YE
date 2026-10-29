import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { MIN_PASSWORD_LENGTH, PASSWORD_HASH_ROUNDS } from '@/lib/admin-auth';
import { caseHandlerId } from '@/lib/domain';
import { listCases } from '@/lib/store';
import { canAssignRole } from '@/lib/user-permissions';
import { activeSessionCounts, createUser, listUsers, temporaryPassword, toPublicUser, type UserRole } from '@/lib/users';
import { requireAdmin } from '@/lib/viewer';

/** Everyone with an account, with what an admin needs to see at a glance. */
export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const [users, cases, sessions] = await Promise.all([listUsers(), listCases(), activeSessionCounts()]);
  return NextResponse.json({
    ok: true,
    data: users.map((u) => ({
      ...toPublicUser(u),
      openCases: cases.filter((c) => c.stage !== 'closed' && caseHandlerId(c) === u.id).length,
      signedInDevices: sessions.get(u.id) ?? 0,
    })),
  });
}

/**
 * Add a person. Without a password the system issues a temporary one, shown
 * once to the admin; the person must choose their own on first sign-in.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  let body: { name?: string; email?: string; phone?: string; role?: UserRole; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }
  const role = body.role === 'admin' ? 'admin' : 'worker';
  if (!canAssignRole(auth.session, role)) {
    return NextResponse.json({ ok: false, error: 'רק בעל המערכת יכול להוסיף מנהלים' }, { status: 403 });
  }
  if (body.password && body.password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ ok: false, error: `הסיסמה צריכה להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים` }, { status: 400 });
  }

  const password = body.password || temporaryPassword();
  const result = await createUser({
    name: body.name || '',
    email: body.email || '',
    phone: body.phone,
    role,
    passwordHash: await bcrypt.hash(password, PASSWORD_HASH_ROUNDS),
    mustChangePassword: true,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json(
    { ok: true, data: toPublicUser(result.user), temporaryPassword: body.password ? undefined : password },
    { status: 201 },
  );
}
