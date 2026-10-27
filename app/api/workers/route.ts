import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { MIN_PASSWORD_LENGTH, PASSWORD_HASH_ROUNDS } from '@/lib/admin-auth';
import { caseHandlerId } from '@/lib/domain';
import { createWorker, listCases, listWorkers } from '@/lib/store';
import { requireAdmin } from '@/lib/viewer';

/** Admin-only. */
export async function GET() {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  const cases = await listCases();
  const workers = (await listWorkers()).map(({ passwordHash: _hash, ...worker }) => ({
    ...worker,
    openCases: cases.filter(
      (c) => c.stage !== 'closed' && caseHandlerId(c) === worker.id,
    ).length,
  }));
  return NextResponse.json({ ok: true, data: workers });
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard instanceof NextResponse) return guard;
  let body: { name?: string; email?: string; password?: string; phone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (!body.name?.trim() || !body.email?.trim() || !body.password || body.password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ ok: false, error: `שם, אימייל וסיסמה (${MIN_PASSWORD_LENGTH} תווים לפחות) הם שדות חובה` }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(body.password, PASSWORD_HASH_ROUNDS);
  const record = await createWorker({ name: body.name, email: body.email, passwordHash, phone: body.phone });
  if (!record) {
    return NextResponse.json({ ok: false, error: 'האימייל כבר קיים במערכת' }, { status: 400 });
  }
  const { passwordHash: _hash, ...safe } = record;
  return NextResponse.json({ ok: true, data: safe }, { status: 201 });
}
