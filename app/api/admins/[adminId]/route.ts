import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { MIN_PASSWORD_LENGTH, PASSWORD_HASH_ROUNDS } from '@/lib/admin-auth';
import { updateAdmin } from '@/lib/store';
import { requireAdmin } from '@/lib/viewer';

type Params = { params: Promise<{ adminId: string }> };

/** Admin-only: rename, activate/deactivate, reset password, phone. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const { adminId } = await params;
  let body: { name?: string; active?: boolean; password?: string; phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  let passwordHash: string | undefined;
  if (body.password) {
    if (body.password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json({ ok: false, error: `סיסמה חייבת להיות באורך ${MIN_PASSWORD_LENGTH} תווים לפחות` }, { status: 400 });
    }
    passwordHash = await bcrypt.hash(body.password, PASSWORD_HASH_ROUNDS);
  }

  const updated = await updateAdmin(adminId, { name: body.name, active: body.active, passwordHash, phone: body.phone });
  if (!updated) return NextResponse.json({ ok: false, error: 'Admin not found' }, { status: 404 });
  const { passwordHash: _hash, ...safe } = updated;
  return NextResponse.json({ ok: true, data: safe });
}
