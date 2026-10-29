import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { MIN_PASSWORD_LENGTH, PASSWORD_HASH_ROUNDS } from '@/lib/admin-auth';
import { consumeRateLimit } from '@/lib/rate-limit';
import { clientIp } from '@/lib/request-ip';
import { completePasswordReset } from '@/lib/users';

/** Public: completes a password reset with the emailed / WhatsApp code. */
export async function POST(request: NextRequest) {
  let body: { email?: string; code?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const email = (body.email || '').trim().toLowerCase();
  const code = (body.code || '').trim();
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!email || !code || newPassword.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { ok: false, error: `אימייל, קוד וסיסמה חדשה (${MIN_PASSWORD_LENGTH} תווים לפחות) הם שדות חובה` },
      { status: 400 },
    );
  }

  if (!(await consumeRateLimit(`reset-ip:${clientIp(request)}`, 20, 15 * 60))) {
    return NextResponse.json({ ok: false, error: 'יותר מדי ניסיונות. נסו שוב בעוד 15 דקות.' }, { status: 429 });
  }

  const passwordHash = await bcrypt.hash(newPassword, PASSWORD_HASH_ROUNDS);
  const result = await completePasswordReset(email, code, passwordHash);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
